// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.17;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeERC721} from "./SafeERC721.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

contract LoanVault {
  using SafeERC721 for IERC721;

  struct LoanPaybackData {
    uint256 amount;
    uint256 timestamp;
  }

  struct Loan {
    address borrower;
    address target;
    uint256 tokenId;
    uint256 liquidatedAmount;
    uint256 amount;
    uint256 duration;
    uint256 interestRate;
    uint256 timestamp;
    string status;
  }

  address public owner;
  uint256 public lockedAmount;
  uint256 public lendedAmount;
  mapping(address => Loan) public loans;
  uint256 internal lendersCount;
  uint256 internal loansCount;
  mapping(uint256 => address) internal loansBorrowers;
  mapping(uint256 => address) public lenders;
  mapping(address => uint256) public lendersBalance;
  AggregatorV3Interface internal nftFloorPriceFeed;

  event LoanCreation(
    address borrower,
    address collateralTargetAddress,
    uint256 collateralTargetTokenId,
    uint256 loanAmount,
    uint256 duration,
    uint256 interestRate,
    uint256 timestamp
  );

  event LoanPayback(
    address borrower,
    uint256 amount,
    uint256 timestamp
  );

  event LoanLiquidation(
    address borrower,
    uint256 amount,
    uint256 timestamp
  );

  event Lend(
    address lender,
    uint256 amount,
    uint256 timestamp
  );

  event Withdraw(
    address lender,
    uint256 amount,
    uint256 timestamp
  );

  constructor(address _owner) {
    lockedAmount = 0;
    loansCount = 0;
    lendersCount = 0;
    owner = _owner;
  }

  function lend() payable public {
    lendersBalance[msg.sender] += msg.value;
    lenders[lendersCount] = msg.sender;
    lockedAmount += msg.value;
    lendedAmount += msg.value;
    lendersCount += 1;

    emit Lend(msg.sender, msg.value, block.timestamp);
  }

  function withdrawalAmount(address _lender) public view returns (uint256) {
    if (lendersBalance[_lender] == 0) {
      return 0;
    }

    uint256 participation = lendersBalance[_lender] / lendedAmount;
    uint256 amount = lockedAmount * participation;

    return amount;
  }

  function balance() public view returns (uint256) {
    return address(this).balance;
  }

  function ownerExit() public {
    require(msg.sender == owner, "Only owner can exit");
    payable(owner).transfer(address(this).balance);
  }

  function withdraw() public {
    require(lendersBalance[msg.sender] > 0, "You don't have any balance to claim");

    uint256 amount = withdrawalAmount(msg.sender);
    require(amount > 0, "You don't have any balance to withdraw");
    require(amount <= address(this).balance, "Not enough balance in the contract");

    bool sendSuccessful = payable(msg.sender).send(amount);
    require(sendSuccessful, "Transfer failed");
    lendersBalance[msg.sender] = 0;
    lockedAmount -= amount;

    emit Withdraw(msg.sender, amount, block.timestamp);
  }

  function loan(
    address _collateralTargetAddress,
    uint256 _collateralTargetTokenId,
    uint256 _duration,
    uint256 _interestRate
  ) public {
    require(lockedAmount >= 0, "Locked amount should be greater than 0");
    require(_duration > 0, "Loan duration should be greater than 0");
    require(_interestRate > 0, "Loan interest rate should be greater than 0");
    require(
      IERC721(_collateralTargetAddress).ownerOf(_collateralTargetTokenId) ==
      msg.sender,
      "Borrower should own the collateral NFT"
    );
    require(
      IERC721(_collateralTargetAddress).getApproved(_collateralTargetTokenId) ==
      address(this),
      "Vault should be approved to transfer the collateral NFT"
    );

    address azuki = 0x9F6d70CDf08d893f0063742b51d3E9D1e18b7f74;
    bool isBlockie = _collateralTargetAddress == 0x46bEF163D6C470a4774f9585F3500Ae3b642e751;

    // If the collateral is a blockie, we use the Azuki's price feed (10% of the floor price)
    nftFloorPriceFeed = AggregatorV3Interface(isBlockie ? azuki : _collateralTargetAddress);
    (, int256 price, , , ) = nftFloorPriceFeed.latestRoundData();
    require(price > 0, "NFT floor price should be greater than 0");

    uint256 fullAmount = isBlockie ? uint256(price / 100) : uint256(price);
    uint256 amount = fullAmount * 60 / 100;
    require(address(this).balance >= amount, "Insufficient liquidity in the vault");

    unchecked {
      require(amount >= 0, "Loan amount should be greater than 0");
      require((lockedAmount -= amount) >= 0, "Insufficient liquidity on vault");
      lockedAmount -= amount;
    }

    IERC721(_collateralTargetAddress).transferFrom(msg.sender, address(this), _collateralTargetTokenId);
    bool sendSuccessful = payable(msg.sender).send(amount);
    require(sendSuccessful, "Transfer failed");
    loansBorrowers[loansCount++] = msg.sender;
    loans[msg.sender] = Loan(
      msg.sender,
      _collateralTargetAddress,
      _collateralTargetTokenId,
      0,
      amount,
      _duration,
      _interestRate,
      block.timestamp,
      "active"
    );

    emit LoanCreation(
      msg.sender,
      _collateralTargetAddress,
      _collateralTargetTokenId,
      amount,
      _duration,
      _interestRate,
      block.timestamp
    );
  }

  function currentPayback(address _borrower) public view returns (LoanPaybackData memory) {
    if (loans[_borrower].amount == 0) {
      return LoanPaybackData(0, 0);
    }

    Loan storage foundLoan = loans[_borrower];
    uint256 interest = (foundLoan.amount * foundLoan.interestRate * (block.timestamp - foundLoan.timestamp)) / 100 / 365;
    return LoanPaybackData(foundLoan.amount + interest, block.timestamp);
  }

  function payback(uint256 timestamp) payable public {
    require(loans[msg.sender].amount > 0, "You don't have a loan");
    require(loans[msg.sender].timestamp + loans[msg.sender].duration < timestamp, "Loan is not expired");

    Loan storage foundLoan = loans[msg.sender];
    uint256 interest = (foundLoan.amount * foundLoan.interestRate * (timestamp - foundLoan.timestamp)) / 100 / 365;
    uint256 totalAmount = foundLoan.amount + interest;

    require(totalAmount > 0, "You don't have any balance to be paid back");
    require(totalAmount <= msg.value, "You're not sending enough tokens to payback the loan");

    lockedAmount += totalAmount;
    foundLoan.status = "paid";
    foundLoan.amount = 0;

    emit LoanPayback(msg.sender, totalAmount, block.timestamp);
  }

  function liquidateLoans() external {
    require(loansCount > 0, "There are no loans to liquidate");
    for (uint256 i = 0; i < loansCount; i++) {
      address borrower = loansBorrowers[i];
      bool isActive = loans[borrower].timestamp + loans[borrower].duration < block.timestamp
        && loans[borrower].amount > 0;
      if (isActive) {
        Loan storage foundLoan = loans[borrower];
        foundLoan.status = "liquidated";
        foundLoan.liquidatedAmount = foundLoan.amount;
        foundLoan.amount = 0;

        emit LoanLiquidation(borrower, foundLoan.liquidatedAmount, block.timestamp);
      }
    }
  }

  function collectionPrice(address _collectionAddress) external view returns (
    uint80 roundId,
    int256 answer,
    uint256 startedAt,
    uint256 updatedAt,
    uint80 answeredInRound
  ) {
    if (_collectionAddress == 0x46bEF163D6C470a4774f9585F3500Ae3b642e751) {
      return AggregatorV3Interface(0x9F6d70CDf08d893f0063742b51d3E9D1e18b7f74).latestRoundData();
    }

    return AggregatorV3Interface(_collectionAddress).latestRoundData();
  }
}
