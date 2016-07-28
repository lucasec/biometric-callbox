var watson = require('watson-developer-cloud');
var request = require('request');
var fs = require('fs');
var Promise = require('promise');
var SoxCommand = require('sox-audio');
var childProcess = require('child_process');
var credentials = require('./credentials');
var phrase = require('./phrase');

exports.create = function (context) {
    var speech_to_text = watson.speech_to_text({
      username: context.watson.username,
      password: context.watson.password,
      version: 'v1'
    });

    var VOICEIT_DEV_ID = context.voiceit.dev_id;

    return {
        writeRecordingFile: function (callSid, stream) {
            return new Promise(function (fulfill, reject) {
                // Create our outgoing stream
                var filename = "recordings/" + callSid + "_audio.wav";
                var writeStream = fs.createWriteStream(filename);
                stream.pipe(writeStream);

                // Handle events from the outgoing stream
                writeStream.on('finish', function () {
                    return fulfill();
                });
                writeStream.on('error', function (error) {
                    return reject(error);
                });

                // Handle errors on the incoming stream
                stream.on('error', function (error) {
                    writeStream.end();
                    return reject(error);
                });
            });
        },

        sendToWatson: function (params, stream) {
            return new Promise(function (fulfill, reject) {
                // Use the provided stream as the audio
                params.audio = stream;

                // Kick off the speech recognition
                speech_to_text.recognize(params, function(error, transcript) {
                    if (error) return reject(error);


                    // Combine any result objects returned from the API
                    var timestamps = [];
                    var words = [];
                    transcript.results.forEach(function (result) {
                        result.alternatives[0].timestamps.forEach(function (ts) {
                            timestamps.push(ts);
                            words.push(ts[0]);
                        });
                    });
                    var saidText = words.join(" ");
                    console.log("Words: " + saidText);

                    // Search for one of the valid phrases
                    var args = ["match.py", saidText].concat(context.phrases);
                    var searchProc = childProcess.spawnSync("python", args);
                    var searchResults = JSON.parse(searchProc.stdout);
                    console.log("Fuzzy search results: ", searchResults);
                    if (searchResults && searchResults.length > 0) {
                        var findPhrase = phrase(searchResults[0].found);
                        findPhrase.acceptAll(saidText);
                        var foundResult = findPhrase.getResult();
                        var firstWord = foundResult.first;
                        var lastWord = foundResult.last;
                        var startTime = timestamps[firstWord][1];
                        var endTime = timestamps[lastWord][2];
                        var duration = endTime - startTime;
                        console.log("Found phrase, starting at word " + firstWord + " and ending at word " + lastWord);
                        console.log("Time range: " + startTime + " -> " + endTime);

                        var uniquePhrase;
                        if (foundResult.first < 2) {
                            // Phrase starts at beginning
                            uniquePhrase = words.slice(foundResult.last + 1).join(" ");
                            console.log("Remainder: " + uniquePhrase);
                        } else {
                            // Phrase starts towards end
                            uniquePhrase = words.slice(0, foundResult.first).join(" ");
                            console.log("Prefix: " + uniquePhrase);
                        }

                        return fulfill({
                            uniquePhrase: uniquePhrase,
                            secretStart: startTime,
                            secretEnd: endTime
                        });
                    } else {
                        return reject(new Error("No valid secret phrase found"));
                    }
                });
            });
        },

        authenticateWithVoiceIt: function(uniquePhrase, secretFile, reqBody) {
            return new Promise(function (fulfill, reject) {
                var user = context.users.getByPhrase(uniquePhrase);
                if (!user) {
                    reject(new Error("Phrase not recognized"));
                }

                var caller = credentials(user.phone);
                var options = {
                    url: 'https://siv.voiceprintportal.com/sivservice/api/authentications',
                    headers: {
                        'VsitAccuracy': 5,
                        'VsitAccuracyPassIncrement' : 2,
                        'VsitAccuracyPasses' : 4,
                        'VsitConfidence' : 85,
                        'VsitDeveloperId' : VOICEIT_DEV_ID,
                        'VsitEmail' : caller.email,
                        'VsitPassword' : caller.password,
                        'Content-Type': 'audio/wav'
                    }
                };

                var authRequest = request.post(options, function(error, response, body) {
                    if (!error && response.statusCode == 200) {
                        var voiceIt = JSON.parse(body);

                        switch(voiceIt.ResponseCode) {
                            case 'SUC':
                                return fulfill(voiceIt);
                            default:
                                return reject(new Error(voiceIt.Result));
                        }
                    } else {
                        return reject(new Error(response.statusCode, body));
                    }
                });

                var readStream = fs.createReadStream(secretFile);
                readStream.pipe(authRequest);
                readStream.on('error', function (error) {
                    return reject(error);
                });
            });
        },

        extractSecret: function(callSid, secretStart, secretEnd) {
            return new Promise(function (fulfill, reject) {
                var audioFilename = "recordings/" + callSid + "_audio.wav";
                var secretFilename = "recordings/" + callSid + "_secret.wav";

                var trimCommand = new SoxCommand()
                    .input(audioFilename)
                    .output(secretFilename)
                    .outputFileType('wav')
                    .trim(secretStart, secretEnd - secretStart);

                trimCommand.on('end', function () {
                    return fulfill(secretFilename);
                });

                trimCommand.on('error', function (error) {
                    return reject(error);
                });

                trimCommand.run();
            });
        }
    };
};

