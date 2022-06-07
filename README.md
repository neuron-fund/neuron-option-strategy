# Architecture

[NeuronThetaVault](./contracts/vaults/NeuronThetaVault.sol) is main contract representing certain option strategy. It works in cycles - rounds, which can be described in the following steps:

1. Gather funds from connected **NeuronCollateralVault** contracts
2. Select strike price and mint options using gathered funds as collateral
3. Initiates auction to sell minted option tokens
4. Close round and distribute profit or loss back to **NeuronCollateralVault**'s

[NeuronCollateralVault](./contracts/vaults/NeuronCollateralVault.sol) is contract which controls deposits and withdrawals for user, mints user share of certain collateral used in **NeuronThetaVault**. It's associated with **NeuronThetaVault** and **NeuronPool**.
Associated **NeuronPool** tokens are the collateral which wich will be used to cover the option. Users can deposit **NeuronPool** tokens directly to **NeuronCollateralVault** or deposit with one of the base assets **NeuronPool** supports (usually 2-4 different assets) which will be wrapped to **NeuronPool**. On round start, **NeuronThetaVault** gathers all funds from **NeuronCollateralVault** and locks it to mint option. On the end of round **NeuronThetaVault** distributes left amounts of **NeuronPool** tokens back to **NeuronCollateralVault** and the profit (if round ended ITM) back to **NeuronCollateralVault**.

[VaultLifecycle](./contracts/libraries/VaultLifecycle.sol) is library of functions controlling **NeuronThetaVault** rounds lifecycle.

[CollateralVaultLifecycle](./contracts/libraries/CollateralVaultLifecycle.sol) is library of functions controlling **NeuronCollateralVault** rounds lifecycle.

[GnosisAuction](./contracts/libraries/GnosisAuction.sol) is library to control open and close of auction selling option tokens.

[NeuronPoolUtils](./contracts/libraries/NeuronPoolUtils.sol) is library of functions to work with **NeuronPool** contract: deposit, withdraw, getting data.

[DeltaStrikeSelection](./contracts/utils/DeltaStrikeSelection.sol) is contract which select best strike price for option, using data from VolatilityOracle and OptionPremiumPricer.
