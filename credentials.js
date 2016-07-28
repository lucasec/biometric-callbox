var SHA256 = require('crypto-js/sha256');

module.exports = function (number) {
    return {
        number: number,
        email: number + '@voiceauth.dev.lucasec.com',
        password: SHA256(number)
    };
};

