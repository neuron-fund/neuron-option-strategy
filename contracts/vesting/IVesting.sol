pragma solidity 0.8.9;

interface IVesting {
    event Initialized(uint8 version);
    event VestingInitialized(address _recipient, uint256 _lockPeriod, uint256 _amount);

    function MINIMUM_LOCK_TIME() external view returns (uint256);

    function claim(address _recipient, uint256 _amount) external;

    function claimedAmount() external view returns (uint256);

    function cliffTime() external view returns (uint256);

    function initialize(
        address _tokenAddress,
        address _recipient,
        uint256 _lockPeriod,
        uint256 _cliffTime,
        uint256 _amount
    ) external;

    function lockEndTime() external view returns (uint256);

    function lockedAmount() external view returns (uint256);

    function recipient() external view returns (address);

    function token() external view returns (address);

    function unclaimed() external view returns (uint256);

    function unlockStartTime() external view returns (uint256);

    function unlockedAmount() external view returns (uint256);
}
