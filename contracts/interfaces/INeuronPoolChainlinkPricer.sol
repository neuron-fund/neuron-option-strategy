// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

interface INeuronPoolChainlinkPricer {
    function aggregator() external view returns (address);

    function aggregatorDecimals() external view returns (uint256);

    function asset() external view returns (address);

    function getPrice() external view returns (uint256);

    function oracle() external view returns (address);

    function setExpiryPriceInOracle(uint256 _expiryTimestamp, uint80 _roundId) external;
}
