pragma solidity 0.8.9;

import {ERC20, IERC20, IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "hardhat/console.sol";

contract MockNeuronPool is ERC20 {
    address public token;
    uint8 public immutable tokenDecimals;

    constructor(
        string memory _name,
        string memory _symbol,
        address _token
    ) ERC20(_name, _symbol) {
        token = _token;
        tokenDecimals = IERC20Metadata(token).decimals();
    }

    function balance() public view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    function deposit(address _token, uint256 _amount) external payable returns (uint256 mintedTokens) {
        require(_token == token, "Unsupported token");
        uint256 _balance = balance();

        IERC20(token).transferFrom(msg.sender, address(this), _amount);

        uint256 _totalSupply = totalSupply();

        uint256 shares = _totalSupply == 0 ? _amount : (_amount * _totalSupply) / _balance;

        console.log("deposit ~ _balance", _balance);
        console.log("deposit ~ _totalSupply", _totalSupply);
        console.log("deposit ~ tokenDecimals", tokenDecimals);
        if (_totalSupply == 0) {
            // Normalize decimals to 18
            shares = tokenDecimals < 18 ? shares * 10**(18 - tokenDecimals) : shares;
        }

        console.log("Deposit:", _amount);
        console.log("shares:", shares);
        _mint(msg.sender, shares);

        return _amount;
    }

    function withdraw(address _token, uint256 _amount) external {
        uint256 _pricePerShare = pricePerShare();

        uint256 amountToWithdraw = (_amount * _pricePerShare) / (1e18);

        IERC20(token).transfer(msg.sender, amountToWithdraw);
        _burn(msg.sender, _amount);
    }

    function pricePerShare() public view returns (uint256) {
        uint256 _totalSupply = totalSupply();
        return _totalSupply == 0 ? 0 : ((IERC20(token).balanceOf(address(this)) * 1e18) / totalSupply());
    }
}
