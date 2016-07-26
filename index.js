var express = require('express');
var path = require('path');
var util = require('util');
var watson = require('watson-developer-cloud');
var twilio = require('twilio');
var request = require('request');
var bodyParser = require('body-parser');
var fs = require('fs');
var phrase = require('./phrase');
var SoxCommand = require('sox-audio');
var SHA256 = require('crypto-js/sha256');
var app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

var root = path.dirname(require.main.filename);

var speech_to_text = watson.speech_to_text({
  username: '***REMOVED***',
  password: '***REMOVED***',
  version: 'v1'
});

var VOICEIT_DEV_ID = '***REMOVED***';

var callerCredentials = function (body) {
    return {
        number: body.From,
        email: body.From + '@voiceauth.dev.lucasec.com',
        password: SHA256(body.From)
    };
};

app.get('/', function (req, res) {
});

app.post('/twilio/start', function(req, res) {
    res.sendFile("twiml/start.xml", {root: root});
});

app.post('/twilio/record', function(req, res) {
    res.sendFile("twiml/record.xml", {root: root});
});

app.post('/twilio/do/record', function(req, res) {
    console.log("Recording callback arrived");

    var recUrl = req.body.RecordingUrl;
    var callSid = req.body.CallSid;

    // Get the recording file
    var recReq = request.get(recUrl);
    var audioFilename = "recordings/" + callSid + "_audio.wav";

    recReq.pipe(fs.createWriteStream(audioFilename)).on('finish', function() {
        console.log("Saved WAV file");
    });

    speech_to_text.recognize({
        audio: recReq,
        content_type: 'audio/wav',
        model: 'en-US_NarrowbandModel',
        continuous: true,
        timestamps: true
    }, function(error, transcript) {
        if (error) {
            console.log('error:', error);
        } else {
            var phrases = [
                phrase("never forget tomorrow is a new day")
            ];

            // Munge results
            var timestamps = [];
            var words = [];
            transcript.results.forEach(function (result) {
                result.alternatives[0].timestamps.forEach(function (ts) {
                    timestamps.push(ts);
                    words.push(ts[0]);
                    phrases.forEach(function (phrase) {
                        phrase.accept(ts[0]);
                    });
                });
            });

            console.log("Words: " + words.join(" "));
            var foundPhrase = phrases.find(function (phrase) {
                return phrase.getResult();
            });

            if (foundPhrase) {
                var foundResult = foundPhrase.getResult();
                var firstWord = foundResult.first;
                var lastWord = foundResult.last;
                var startTime = timestamps[firstWord][1];
                var endTime = timestamps[lastWord][2];
                var duration = endTime - startTime;
                console.log("Found phrase, starting at word " + firstWord + " and ending at word " + lastWord);
                console.log("Time range: " + startTime + " -> " + endTime);

                if (foundResult.first < 2) {
                    // Phrase starts at beginning
                    console.log("Remainder: " + words.slice(foundResult.last + 1).join(" "));
                } else {
                    // Phrase starts towards end
                    console.log("Prefix: " + words.slice(0, foundResult.first).join(" "));
                }

                // Use SoX to cut the stream
                var trimCommand = new SoxCommand()
                    .input(audioFilename)
                    .output("recordings/" + callSid + "_secret.wav")
                    .outputFileType('wav')
                    .trim(startTime, duration);

                trimCommand.on('end', function () {
                    console.log("Audio trimmed");
                var caller       = callerCredentials(req.body);
                var options      = {
                    url: 'https://siv.voiceprintportal.com/sivservice/api/authentications',
                    headers: {
                      'VsitAccuracy'              : 5,
                      'VsitAccuracyPassIncrement' : 2,
                      'VsitAccuracyPasses'        : 4,
                      'VsitConfidence'            : 89,
                      'VsitDeveloperId'           : VOICEIT_DEV_ID,
                      'VsitEmail'                 : caller.email,
                      'VsitPassword'              : caller.password,
                      'Content-Type'              : 'audio/wav'
                    }
                };

                var vitreq = request.post(options, function(error, response, body) {

                if (!error && response.statusCode == 200) {
                  var voiceIt = JSON.parse(body);
                  console.log(voiceIt);

                  switch(voiceIt.Result) {
                    case 'Authentication failed.':
                      console.log("FAILED");
                      break;
                    default:
                      console.log("SUCCESS");
                  }
                } else {
                  console.log("API error");

                  new Error(response.statusCode, body);
                }

                });
                fs.createReadStream("recordings/" + callSid + "_secret.wav").pipe(vitreq);
                });

                trimCommand.on('error', function (err) {
                    console.log('Cannot process audio: ' + err.message);
                });

                trimCommand.run();


            } else {
                console.log("Did not find phrase");
            }
        }
      });

    res.sendFile("twiml/hangup.xml", {root: root});

});

app.post('/twilio/do/transcribe', function(req, res) {
    console.log(util.format("Got transcription: %s (%s)", req.query.TranscriptionUrl,
        req.query.TranscriptionStatus));
    res.end();
});

app.listen(3000, function () {
  console.log('Example app listening on port 3000!');
});

app.post('/incoming_call', function(req, res) {
  var caller  = callerCredentials(req.body);
  var twiml   = new twilio.TwimlResponse();
  // Prepare options for the VoiceIt `GET /sivservice/api/users` API request.
  var options = {
    url: 'https://siv.voiceprintportal.com/sivservice/api/users',
    headers: {
      'VsitEmail'       : caller.email,
      'VsitPassword'    : caller.password,
      'VsitDeveloperId' : VOICEIT_DEV_ID
    }
  };

  request(options, function (error, response,  body) {
    // When VoiceIt responds with at `200`, we know the user's account profile
    // exists in the VoiceIt system.
    if (!error && response.statusCode == 200) {
      var voiceIt = JSON.parse(body);

      // Let's provide the caller with an opportunity to enroll by typing `1` on
      // their phone's keypad.
      twiml.redirect('/twilio/record');

      res.send(twiml.toString());
    } else {
      switch(response.statusCode) {
        // Create a VoiceIt user when the HTTP status is `412 Precondition Failed`.
        case 412:
          // Prepare options for the VoiceIt `POST /sivservice/api/users` API request.
          var options = {
            url: 'https://siv.voiceprintportal.com/sivservice/api/users',
            headers: {
              'VsitDeveloperId' : VOICEIT_DEV_ID,
              'VsitEmail'       : caller.email,
              'VsitFirstName'   : 'First' + caller.number,
              'VsitLastName'    : 'Last' + caller.number,
              'VsitPassword'    : caller.password,
              'VsitPhone1'      : caller.number
            }
          };

          request.post(options, function (error, response,  body) {
            if (!error && response.statusCode == 200) {
              var voiceIt = JSON.parse(body);
              console.log(voiceIt);
            } else {
              console.log(response.statusCode);
              console.log(body);
            }
          });

          twiml.say(
            'Welcome to the Voice Authentication system. You are a new user, ' +
            'you will now be enrolled.'
          );
          // Then we'll want to send them immediately to enrollment.
          twiml.redirect({ digits: '1' }, '/enroll');

          res.send(twiml.toString());
          break;
        default:
          new Error('An unhandled error occured');
      }
    }
  });
});

app.post('/enroll', function(req, res) {
  var enrollCount = req.query.enrollCount || 0;
  var twiml       = new twilio.TwimlResponse();

  twiml.say('Please say the following phrase to enroll.');
  twiml.pause(1);
  twiml.say('Never forget tomorrow is a new day.');
  twiml.record({
    action    : '/process_enrollment?enrollCount=' + enrollCount,
    maxLength : 5,
    trim      : 'do-not-trim'
  });

  res.send(twiml.toString());
});

app.post('/enroll_or_authenticate', function(req, res) {
  var digits = req.body.digits;
  var twiml  = new twilio.TwimlResponse();

  // When the caller asked to enroll by pressing `1`, provide friendly
  // instructions, otherwise, we always assume their intent is to authenticate.
  if (digits == 1) {
    twiml.say(
      'You have chosen to create a new account with your voice. You will be ' +
      'asked to say a phrase 3 times, then you will be able to log in with that phrase.'
    );
    twiml.redirect('/enroll');
  } else {
    twiml.redirect('/authenticate');
  }

  res.send(twiml.toString());
});

app.post('/process_enrollment', function(req, res) {
  var caller       = callerCredentials(req.body);
  var enrollCount  = req.query.enrollCount;
  var recordingURL = req.body.RecordingUrl + ".wav";
  // Prepare options for the VoiceIt `POST /sivservice/api/enrollments/bywavurl API request.
  var options      = {
    url: 'https://siv.voiceprintportal.com/sivservice/api/enrollments/bywavurl',
    headers: {
      'VsitDeveloperId' : VOICEIT_DEV_ID,
      'VsitEmail'       : caller.email,
      'VsitPassword'    : caller.password,
      'VsitwavURL'      : recordingURL
    }
  };

  request.post(options, function (error, response, body) {
    var twiml = new twilio.TwimlResponse();

    if (!error && response.statusCode == 200) {
      var voiceIt = JSON.parse(body);

      if (voiceIt.Result == 'Success') {
        enrollCount++;
        // VoiceIt requires at least 3 successful enrollments.
        if (enrollCount > 2) {
          twiml.say(
            'Thank you, recording recieved. You are now enrolled.'
          );
          twiml.hangup();
        } else {
          twiml.say(
            'Thank you, recording recieved. You will now be asked to record your phrase again.'
          );
          twiml.redirect('/enroll?enrollCount=' + enrollCount);
        }
      } else {
        twiml.say('Sorry, your recording did not stick. Please try again.');
        twiml.redirect('/enroll?enrollCount=' + enrollCount);
      }
    } else {
      twiml.say('Sorry, your recording did not stick. Please try again');
      twiml.redirect('/enroll?enrollCount=' + enrollCount);
    }

    res.send(twiml.toString());
  });
});

