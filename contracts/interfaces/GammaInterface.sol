// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

interface IOtoken {
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Transfer(address indexed from, address indexed to, uint256 value);

    function DOMAIN_SEPARATOR() external view returns (bytes32);

    function allowance(address owner, address spender) external view returns (uint256);

    function approve(address spender, uint256 amount) external returns (bool);

    function balanceOf(address account) external view returns (uint256);

    function burnOtoken(address account, uint256 amount) external;

    function collateralAssets(uint256) external view returns (address);

    function collateralsAmounts(uint256) external view returns (uint256);

    function collateralsValues(uint256) external view returns (uint256);

    function collaterizedTotalAmount() external view returns (uint256);

    function controller() external view returns (address);

    function decimals() external view returns (uint8);

    function decreaseAllowance(address spender, uint256 subtractedValue) external returns (bool);

    function expiryTimestamp() external view returns (uint256);

    function getCollateralAssets() external view returns (address[] memory);

    function getCollateralsAmounts() external view returns (uint256[] memory);

    function getCollateralsValues() external view returns (uint256[] memory);

    function getOtokenDetails()
        external
        view
        returns (
            address[] memory,
            uint256[] memory,
            address,
            address,
            uint256,
            uint256,
            bool,
            uint256
        );

    function increaseAllowance(address spender, uint256 addedValue) external returns (bool);

    function init(
        address _addressBook,
        address _underlyingAsset,
        address _strikeAsset,
        address[] memory _collateralAssets,
        uint256 _strikePrice,
        uint256 _expiryTimestamp,
        bool _isPut
    ) external;

    function isPut() external view returns (bool);

    function mintOtoken(
        address account,
        uint256 amount,
        uint256[] memory collateralsAmountsForMint,
        uint256[] memory collateralsValuesForMint
    ) external;

    function name() external view returns (string memory);

    function nonces(address owner) external view returns (uint256);

    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    function reduceCollaterization(
        uint256[] memory collateralsAmountsForReduce,
        uint256[] memory collateralsValuesForReduce,
        uint256 oTokenAmountBurnt
    ) external;

    function strikeAsset() external view returns (address);

    function strikePrice() external view returns (uint256);

    function symbol() external view returns (string memory);

    function totalSupply() external view returns (uint256);

    function transfer(address recipient, uint256 amount) external returns (bool);

    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) external returns (bool);

    function underlyingAsset() external view returns (address);
}

interface IOtokenFactory {
    event OtokenCreated(
        address tokenAddress,
        address creator,
        address indexed underlying,
        address indexed strike,
        address[] indexed collateral,
        uint256 strikePrice,
        uint256 expiry,
        bool isPut
    );

    function addressBook() external view returns (address);

    function createOtoken(
        address _underlyingAsset,
        address _strikeAsset,
        address[] memory _collateralAssets,
        uint256 _strikePrice,
        uint256 _expiry,
        bool _isPut
    ) external returns (address);

    function getOtoken(
        address _underlyingAsset,
        address _strikeAsset,
        address[] memory _collateralAssets,
        uint256 _strikePrice,
        uint256 _expiry,
        bool _isPut
    ) external view returns (address);

    function getOtokensLength() external view returns (uint256);

    function getTargetOtokenAddress(
        address _underlyingAsset,
        address _strikeAsset,
        address[] memory _collateralAssets,
        uint256 _strikePrice,
        uint256 _expiry,
        bool _isPut
    ) external view returns (address);

    function otokens(uint256) external view returns (address);
}

interface IController {
    event AccountOperatorUpdated(address indexed accountOwner, address indexed operator, bool isSet);
    event CallExecuted(address indexed from, address indexed to, bytes data);
    event CallRestricted(bool isRestricted);
    event CollateralAssetDeposited(
        address indexed asset,
        address indexed accountOwner,
        address indexed from,
        uint256 vaultId,
        uint256 amount
    );
    event CollateralAssetWithdrawed(
        address indexed asset,
        address indexed accountOwner,
        address indexed to,
        uint256 vaultId,
        uint256 amount
    );
    event Donated(address indexed donator, address indexed asset, uint256 amount);
    event FullPauserUpdated(address indexed oldFullPauser, address indexed newFullPauser);
    event LongOtokenDeposited(
        address indexed otoken,
        address indexed accountOwner,
        address indexed from,
        uint256 vaultId,
        uint256 amount
    );
    event LongOtokenWithdrawed(
        address indexed otoken,
        address indexed accountOwner,
        address indexed to,
        uint256 vaultId,
        uint256 amount
    );
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event PartialPauserUpdated(address indexed oldPartialPauser, address indexed newPartialPauser);
    event Redeem(
        address indexed otoken,
        address indexed redeemer,
        address indexed receiver,
        address[] collateralAssets,
        uint256 otokenBurned,
        uint256[] payouts
    );
    event ShortOtokenBurned(
        address indexed otoken,
        address indexed accountOwner,
        address indexed from,
        uint256 vaultId,
        uint256 amount
    );
    event ShortOtokenMinted(
        address indexed otoken,
        address indexed accountOwner,
        address indexed to,
        uint256 vaultId,
        uint256 amount
    );
    event SystemFullyPaused(bool isPaused);
    event SystemPartiallyPaused(bool isPaused);
    event VaultLiquidated(
        address indexed liquidator,
        address indexed receiver,
        address indexed vaultOwner,
        uint256 auctionPrice,
        uint256 auctionStartingRound,
        uint256 collateralPayout,
        uint256 debtAmount,
        uint256 vaultId
    );
    event VaultOpened(address indexed accountOwner, uint256 vaultId);
    event VaultSettled(
        address indexed accountOwner,
        address indexed shortOtoken,
        address to,
        uint256[] payouts,
        uint256 vaultId
    );

    function accountVaultCounter(address) external view returns (uint256);

    function addressbook() external view returns (address);

    function calculator() external view returns (address);

    function callRestricted() external view returns (bool);

    function canSettleAssets(
        address _underlying,
        address _strike,
        address[] memory _collaterals,
        uint256 _expiry
    ) external view returns (bool);

    function donate(address _asset, uint256 _amount) external;

    function fullPauser() external view returns (address);

    function getProceed(address _owner, uint256 _vaultId) external view returns (uint256[] memory);

    function getVault(address _owner, uint256 _vaultId) external view returns (MarginVault.Vault memory);

    function getVaultWithDetails(address _owner, uint256 _vaultId)
        external
        view
        returns (MarginVault.Vault memory, uint256);

    function initialize(address _addressBook, address _owner) external;

    function isOperator(address _owner, address _operator) external view returns (bool);

    function operate(Actions.ActionArgs[] memory _actions) external;

    function oracle() external view returns (address);

    function owner() external view returns (address);

    function partialPauser() external view returns (address);

    function pool() external view returns (address);

    function refreshConfiguration() external;

    function renounceOwnership() external;

    function setCallRestriction(bool _isRestricted) external;

    function setFullPauser(address _fullPauser) external;

    function setOperator(address _operator, bool _isOperator) external;

    function setPartialPauser(address _partialPauser) external;

    function setSystemFullyPaused(bool _fullyPaused) external;

    function setSystemPartiallyPaused(bool _partiallyPaused) external;

    function sync(address _owner, uint256 _vaultId) external;

    function systemFullyPaused() external view returns (bool);

    function systemPartiallyPaused() external view returns (bool);

    function transferOwnership(address newOwner) external;

    function vaults(address, uint256)
        external
        view
        returns (
            address shortOtoken,
            address longOtoken,
            uint256 shortAmount,
            uint256 longAmount,
            uint256 usedLongAmount
        );

    function whitelist() external view returns (address);

    function getAccountVaultCounter(address _accountOwner) external view returns (uint256);
}

interface MarginVault {
    struct Vault {
        address shortOtoken;
        // addresses of oTokens a user has shorted (i.e. written) against this vault
        // addresses of oTokens a user has bought and deposited in this vault
        // user can be long oTokens without opening a vault (e.g. by buying on a DEX)
        address longOtoken;
        // addresses of other ERC-20s a user has deposited as collateral in this vault
        address[] collateralAssets;
        // quantity of oTokens minted/written for each oToken address in oTokenAddress
        uint256 shortAmount;
        // quantity of oTokens owned and held in the vault for each oToken address in longOtokens
        uint256 longAmount;
        uint256 usedLongAmount;
        // quantity of ERC-20 deposited as collateral in the vault for each ERC-20 address in collateralAssets
        uint256[] collateralAmounts;
        // Collateral which is currently used for minting oTokens and can't be used until expiry
        uint256[] reservedCollateralAmounts;
        uint256[] usedCollateralValues;
        uint256[] availableCollateralAmounts;
    }
}

interface Actions {
    struct ActionArgs {
        uint8 actionType;
        address owner;
        address secondAddress;
        address[] assets;
        uint256 vaultId;
        uint256[] amounts;
        bytes data;
    }

    enum ActionType {
        OpenVault,
        MintShortOption,
        BurnShortOption,
        DepositLongOption,
        WithdrawLongOption,
        DepositCollateral,
        WithdrawCollateral,
        SettleVault,
        Redeem,
        Call
    }
}
