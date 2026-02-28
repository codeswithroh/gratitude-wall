// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Leaderboard {
    uint256 public constant MAX_ENTRIES = 20;
    uint256 public constant NAME_COOLDOWN = 1 days;

    struct Entry {
        address player;
        uint256 score;
    }

    mapping(address => uint256) public bestScore;
    mapping(address => string) public playerName;
    mapping(bytes32 => address) public nameOwner;
    mapping(address => uint256) public lastNameChange;
    Entry[] public top;

    event ScoreSubmitted(address indexed player, uint256 score, uint256 timestamp);
    event NameUpdated(address indexed player, string name);

    function setName(string calldata name) external {
        require(bytes(name).length > 0, "empty");
        require(bytes(name).length <= 16, "too long");
        require(block.timestamp >= lastNameChange[msg.sender] + NAME_COOLDOWN, "cooldown");
        bytes32 key = keccak256(bytes(_normalize(name)));
        address currentOwner = nameOwner[key];
        require(currentOwner == address(0) || currentOwner == msg.sender, "taken");

        string memory prev = playerName[msg.sender];
        if (bytes(prev).length > 0) {
            bytes32 prevKey = keccak256(bytes(_normalize(prev)));
            if (nameOwner[prevKey] == msg.sender) {
                nameOwner[prevKey] = address(0);
            }
        }

        playerName[msg.sender] = name;
        nameOwner[key] = msg.sender;
        lastNameChange[msg.sender] = block.timestamp;
        emit NameUpdated(msg.sender, name);
    }

    function submitScore(uint256 score) external {
        require(score > 0, "score=0");
        uint256 current = bestScore[msg.sender];
        if (score <= current) {
            emit ScoreSubmitted(msg.sender, score, block.timestamp);
            return;
        }

        bestScore[msg.sender] = score;
        _updateTop(msg.sender, score);
        emit ScoreSubmitted(msg.sender, score, block.timestamp);
    }

    function getTopScores()
        external
        view
        returns (address[] memory players, uint256[] memory scores, string[] memory names)
    {
        uint256 len = top.length;
        players = new address[](len);
        scores = new uint256[](len);
        names = new string[](len);
        for (uint256 i = 0; i < len; i++) {
            players[i] = top[i].player;
            scores[i] = top[i].score;
            names[i] = playerName[top[i].player];
        }
    }

    function _updateTop(address player, uint256 score) internal {
        uint256 len = top.length;
        bool found = false;

        for (uint256 i = 0; i < len; i++) {
            if (top[i].player == player) {
                top[i].score = score;
                found = true;
                break;
            }
        }

        if (!found) {
            if (len < MAX_ENTRIES) {
                top.push(Entry(player, score));
                len = top.length;
            } else {
                uint256 minIndex = 0;
                for (uint256 i = 1; i < len; i++) {
                    if (top[i].score < top[minIndex].score) {
                        minIndex = i;
                    }
                }
                if (score > top[minIndex].score) {
                    top[minIndex] = Entry(player, score);
                } else {
                    return;
                }
            }
        }

        // sort descending (simple insertion/bubble)
        for (uint256 i = 0; i < len; i++) {
            for (uint256 j = i + 1; j < len; j++) {
                if (top[j].score > top[i].score) {
                    Entry memory temp = top[i];
                    top[i] = top[j];
                    top[j] = temp;
                }
            }
        }
    }

    function _normalize(string memory input) internal pure returns (string memory) {
        bytes memory b = bytes(input);
        for (uint256 i = 0; i < b.length; i++) {
            uint8 c = uint8(b[i]);
            if (c >= 65 && c <= 90) {
                b[i] = bytes1(c + 32);
            }
        }
        return string(b);
    }
}
