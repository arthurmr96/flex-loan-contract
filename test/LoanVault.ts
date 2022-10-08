import { ethers } from "hardhat";
import { expect } from "chai";
import faucetAbi from "../abi/faucet.json";
import erc20Abi from "../abi/erc20.json";
import erc721Abi from "../abi/erc721.json";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { coins } from "../utils/helpers"

describe("LoanVault", function () {
    const buckie = "0xF2dA2EBfE236e067FB97409f558c5Bef41081577"
    const blockie = "0x46bEF163D6C470a4774f9585F3500Ae3b642e751"

    async function deployLoanVaultFixture() {
        // Contracts are deployed using the first signer/account by default
        const [owner, accountOne, accountTwo] = await ethers.getSigners();

        const paymentToken = buckie
        const LoanVault = await ethers.getContractFactory("LoanVault");
        const loanVault = await LoanVault.deploy();
        await loanVault.deployed();

        return { loanVault, paymentToken, owner, accountOne, accountTwo };
    }

    async function generateFaucet(token: string, signer: SignerWithAddress) {
        const contract = new ethers.Contract(token, faucetAbi, signer);
        await contract.faucet()
    }

    async function transferErc20(token: string, signer: SignerWithAddress, spender: string, amount: string) {
        const contract = new ethers.Contract(token, erc20Abi, signer);
        await contract.transfer(spender, ethers.utils.parseEther(amount))
    }

    async function approveErc721(token: string, signer: SignerWithAddress, to: string, tokenId: string) {
        const contract = new ethers.Contract(token, erc20Abi, signer);
        await contract.approve(to, tokenId)
    }

    async function getNftCollectionItem(token: string, signer: SignerWithAddress): Promise<string> {
        const contract = new ethers.Contract(token, erc721Abi, signer);
        const tokenId = await contract.tokenOfOwnerByIndex(signer.address, 0)
        return tokenId.toString()
    }

    describe("Deployment", function () {
        it("should set the right payment token", function (done) {
            const execute = async () => {
                const { loanVault, paymentToken } = await loadFixture(deployLoanVaultFixture);
                expect(await loanVault.paymentToken()).to.equal(paymentToken);
            }
            execute().then(done, done);
        }).timeout(10000);
    });

    describe("Loan", function () {
        it('should return insufficient liquidity in the vault', function (done) {
            const execute = async () => {
                const { loanVault, accountOne } = await loadFixture(deployLoanVaultFixture);
                const updatedVault = loanVault.connect(accountOne)
                await generateFaucet(blockie, accountOne)
                const tokenId = await getNftCollectionItem(blockie, accountOne)
                await approveErc721(blockie, accountOne, loanVault.address, tokenId)
                const loanAmount = ethers.utils.parseEther("2")

                expect(updatedVault.loan(blockie, tokenId, loanAmount.toString(), 30, 3)).to.be.revertedWith("VM Exception while processing transaction: reverted with reason string 'Insufficient liquidity in the vault'")
            }
            execute().then(done, done);
        }).timeout(20000);

        it('should lend 1 ETH to the contract', function (done) {
            const execute = async () => {
                const { loanVault, accountOne } = await loadFixture(deployLoanVaultFixture);
                const updatedVault = loanVault.connect(accountOne)
                const initialAmount = await loanVault.lockedAmount()
                await updatedVault.lend({ value: ethers.utils.parseEther('1') })
                const currentAmountUin256 = await loanVault.lockedAmount()
                const currentAmount = coins(currentAmountUin256.toString(), 18)

                expect(Number(currentAmount)).to.equal((Number(coins(initialAmount.toString(), 18)) + 1));
            }
            execute().then(done, done);
        }).timeout(20000);

        it('should withdraw 1 ETH after staking it on the vault', function (done) {
            const execute = async () => {
                const { loanVault, accountOne } = await loadFixture(deployLoanVaultFixture);
                const updatedVault = loanVault.connect(accountOne)
                const initialAmount = await loanVault.lockedAmount()
                await updatedVault.lend({ value: ethers.utils.parseEther('1') })
                await updatedVault.withdraw()
                const finalAmountUint256 = await loanVault.lockedAmount()
                const finalAmount = coins(finalAmountUint256.toString(), 18)
                expect(Number(finalAmount)).to.equal(Number(coins(initialAmount.toString(), 18)));
            }
            execute().then(done, done);
        }).timeout(20000);

        it('should loan 1 ETH for 1 KIE', function (done) {
            const execute = async () => {
                const { loanVault, accountOne } = await loadFixture(deployLoanVaultFixture);
                loanVault.lend({ value: ethers.utils.parseEther('1') })
                const updatedVault = loanVault.connect(accountOne)
                await generateFaucet(blockie, accountOne)
                const tokenId = await getNftCollectionItem(blockie, accountOne)
                await approveErc721(blockie, accountOne, loanVault.address, tokenId)
                await updatedVault.loan(blockie, tokenId, 30, 3)
                const currentAmountUint256 = await loanVault.lockedAmount()
                const currentAmount = coins(currentAmountUint256.toString(), 18)

                expect(Number(currentAmount)).greaterThan(0);
            }
            execute().then(done, done);
        }).timeout(20000);

        it('should return the updated value to be paid after the creation of a loan', function (done) {
            const execute = async () => {
                const { loanVault, accountOne } = await loadFixture(deployLoanVaultFixture);
                loanVault.lend({ value: ethers.utils.parseEther('1') })
                const updatedVault = loanVault.connect(accountOne)
                await generateFaucet(blockie, accountOne)
                const tokenId = await getNftCollectionItem(blockie, accountOne)
                await approveErc721(blockie, accountOne, loanVault.address, tokenId)
                await updatedVault.loan(blockie, tokenId, 30, 3)
                const beforeAmountUint256 = await loanVault.currentPaybackAmount(accountOne.address)
                const beforeAmount = coins(beforeAmountUint256.toString(), 18)

                await ethers.provider.send("evm_increaseTime", [3600])
                await ethers.provider.send("evm_mine", [])

                const currentAmountUint256 = await loanVault.currentPaybackAmount(accountOne.address)
                const currentAmount = coins(currentAmountUint256.toString(), 18)

                expect(Number(currentAmount)).greaterThan(Number(beforeAmount));
            }
            execute().then(done, done);
        }).timeout(20000);

        it('should payback after the loan has been executed', function (done) {
            const execute = async () => {
                const { loanVault, accountOne } = await loadFixture(deployLoanVaultFixture);
                loanVault.lend({ value: ethers.utils.parseEther('1') })
                const updatedVault = loanVault.connect(accountOne)
                await generateFaucet(blockie, accountOne)
                const tokenId = await getNftCollectionItem(blockie, accountOne)
                await approveErc721(blockie, accountOne, loanVault.address, tokenId)
                await updatedVault.loan(blockie, tokenId, 30, 3)

                await ethers.provider.send("evm_increaseTime", [3600])
                await ethers.provider.send("evm_mine", [])

                const currentPayback = await loanVault.currentPayback(accountOne.address)
                await updatedVault.payback(currentPayback.timestamp, { value: currentPayback.amount })

                const afterPayback = await loanVault.currentPayback(accountOne.address)
                const afterPaybackAmountUint256 = afterPayback.amount
                const updatedLoanAmount = (await loanVault.loans(accountOne.address)).amount

                expect(Number(afterPaybackAmountUint256.toString())).equal(0);
                expect(Number(updatedLoanAmount.toString())).equal(0);
            }
            execute().then(done, done);
        });
    });
});
