pragma solidity 0.8.9;

contract MockOptionsPremiumPricer {
    uint256 internal premium;

    function setPremium(uint256 _premium) public {
        premium = _premium;
    }

    function getPremium(
        uint256,
        uint256,
        bool
    ) external view returns (uint256) {
        return premium;
    }
}
