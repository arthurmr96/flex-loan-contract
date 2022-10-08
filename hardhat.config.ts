import {HardhatUserConfig} from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
    solidity: "0.8.17",
    networks: {
        hardhat: {
          forking: {
            url: "https://goerli.infura.io/v3/f3fb60d30bcd4eb88b643e0175813059",
          },
        },
        goerli: {
            url: "https://goerli.infura.io/v3/f3fb60d30bcd4eb88b643e0175813059",
            accounts: ["a40784bc64b9b0ccc7a549daf1ac43204903663b73f92202b1c9cf2e79a4639a"],
        }
    },
    etherscan: {
        apiKey: {
            goerli: 'A2P98UFZGF2FYJCSCMVP5P28AKH7F1HRZ8'
        }
    }
};

export default config;
