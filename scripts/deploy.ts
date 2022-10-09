import { ethers } from "hardhat";

async function main() {
  const LoanVault = await ethers.getContractFactory("LoanVault");
  const loanVault = await LoanVault.deploy("0xdC4d86Da67B12DFD72F41B782ac1D04394506196");

  await loanVault.deployed();

  console.log(`LoanVault deployed to ${loanVault.address} on tx ${loanVault.deployTransaction.hash} at block ${loanVault.deployTransaction.blockNumber}`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
