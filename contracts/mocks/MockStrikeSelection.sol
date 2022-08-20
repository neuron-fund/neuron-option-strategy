pragma solidity 0.8.9;

contract MockStrikeSelection {
    uint256 internal strike;

    uint256 public constant delta = 1000;

    function setStrikePrice(uint256 _strike) public {
        strike = _strike;
    }

    function getStrikePrice(uint256, bool) external view returns (uint256, uint256) {
        return (strike, delta);
    }
}
