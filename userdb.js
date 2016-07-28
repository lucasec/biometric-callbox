/**
 * Super simple hard-coded user database
 */

var childProcess = require('child_process');

module.exports = function () {
    var phraseMap = {};
    var phoneMap = {};
    var phraseSet = [];
    var matchTolerance = 0.5;

    return {
        add: function (name, phone, phrase) {
            if (phraseMap[phrase]) {
                throw new Error("Phrase already exists");
            }

            var user = {
                name: name,
                phone: phone,
                phrase: phrase
            };

            phraseMap[phrase] = user;
            phoneMap[phone] = user;
            phraseSet.push(phrase);
        },

        getByPhrase: function (phrase) {
            var args = ["match.py", phrase].concat(phraseSet);
            var proc = childProcess.spawnSync("python", args);
            var results = JSON.parse(proc.stdout);

            if (!results || results.length === 0) {
                return;
            }

            var matchedPhrase = results[0].search;

            return phraseMap[matchedPhrase];
        },

        getByPhone: function (phone) {
            return phoneMap[phone];
        }
    };
};

