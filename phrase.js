// Phrase detector

module.exports = function (phrase) {
    var words = phrase.split(" ");
    var found = false;
    var nextWord = 0;
    var index = 0;
    var first = -1;
    var last = -1;

    return {
        accept: function (word) {
            // If we've already found our phrase, nothing more to do
            if (found) {
                return;
            }

            var lookingFor = words[nextWord].toLowerCase().trim();
            var got = word.toLowerCase().trim();

            if (lookingFor === got) {
                // Found the next word, update first/last index
                if (nextWord === 0) {
                    first = index;
                } else if (nextWord === words.length - 1) {
                    last = index;
                    found = true;
                }

                // Start looking for the next word
                nextWord++;
            } else {
                // Reset our search if we find an out-of-phrase word
                nextWord = 0;
                first = -1;
                last = -1;
            }

            // Regardless, advance our search index
            index++;
        },

        acceptAll: function (phrase) {
            var words = phrase.split(" ");
            words.forEach(this.accept);
        },

        reset: function () {
            index = 0;
            found = false;
            first = -1;
            last = -1;
            nextWord = 0;
        },

        getResult: function () {
            if (found) {
                return {
                    first: first,
                    last: last
                };
            } else {
                return null;
            }
        }
    };
};

