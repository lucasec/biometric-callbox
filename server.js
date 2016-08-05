var express = require('express');
var path = require('path');
var util = require('util');
var watson = require('watson-developer-cloud');
var twilio = require('twilio');
var request = require('request');
var bodyParser = require('body-parser');
var fs = require('fs');
var stages = require('./stages');
var userdb = require('./userdb');
var credentials = require('./credentials');
var Promise = require('promise');

// Load configuration
var config = JSON.parse(fs.readFileSync("config.json", "utf8"));

var context = {
    watson: {
        username: config.watson.username,
        password: config.watson.password
    },
    voiceit: {
        dev_id: config.voiceit.dev_id
    },
    phrases: config.phrases,
    users: userdb(),
    twilio: twilio(config.twilio.account_sid, config.twilio.auth_token),
    url: config.url
};

var user;
for (var userIndex in config.users) {
    user = config.users[userIndex];
    console.log("Adding user: ", user);
    context.users.add(user.name, user.phone, user.phrase);
}

// Set up our app
var app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.stages = stages.create(context); // common tasks we use in requests

app.listen(3000, function () {
  console.log('App listening on port 3000!');
});

var root = path.dirname(require.main.filename);

app.get('/', function (req, res) {
    res.send("Hello, you've reached the demo app");
});

app.post('/authenticate', function(req, res) {
    var twiml = new twilio.TwimlResponse();
    twiml.say("Please identify after the beep");
    twiml.record({
        action: '/process_authenticate',
        timeout: 3
    });

    res.send(twiml.toString());
});

app.post('/process_authenticate', function(req, res) {
    console.log("Recording callback arrived");

    var recUrl = req.body.RecordingUrl;
    var callSid = req.body.CallSid;

    // Get the recording file
    var recordingStream = request.get(recUrl);

    Promise.all([
        app.stages.writeRecordingFile(callSid, recordingStream),
        app.stages.sendToWatson({
            content_type: 'audio/wav',
            model: 'en-US_NarrowbandModel',
            continuous: true,
            timestamps: true
        }, recordingStream)
    ]).then(function (results) {
        // Have the secret phrase trimmed out
        return Promise.all([
            results[1].uniquePhrase, // need to pass through the phrase from the original result
            app.stages.extractSecret(callSid, results[1].secretStart, results[1].secretEnd)
        ]);
    }).then(function (results) {
        return app.stages.authenticateWithVoiceIt(results[0], results[1], req.body);
    }).then(function (result) {
        console.log("Auth result: ", result);
        context.twilio.calls(callSid).update({
            url: context.url + "/accept_authenticate",
            method: "POST"
        }, function(err, call) {
            if (err) {
                console.log(err);
            }
        });
    }).catch(function (error) {
        console.log(error);
        context.twilio.calls(callSid).update({
            url: context.url + "/reject_authenticate",
            method: "POST"
        }, function(err, call) {
            if (err) {
                console.log(err);
            }
        });
    });

    var twiml = new twilio.TwimlResponse();
    twiml.say("Authorizing");
    twiml.play("http://com.twilio.sounds.music.s3.amazonaws.com/ClockworkWaltz.mp3");
    twiml.say("I'm sorry, we cannot process your authorization at this time");
    twiml.hangup();
    res.send(twiml.toString());
});

app.post('/reject_authenticate', function(req, res) {
    var twiml = new twilio.TwimlResponse();
    twiml.say("Access denied");
    twiml.hangup();
    res.send(twiml.toString());
});

app.post('/accept_authenticate', function(req, res) {
    var twiml = new twilio.TwimlResponse();
    twiml.say("Welcome");
    twiml.play("", {digits: "999"});
    twiml.hangup();
    res.send(twiml.toString());
});

app.post('/incoming_call', function(req, res) {
  var twiml   = new twilio.TwimlResponse();

  if (!context.users.getByPhone(req.body.From)) {
    console.log("Did not recognize " + req.body.From);
    twiml.say("Your number was not recognized");
    twiml.hangup();
    res.send(twiml.toString());
    return;
  }

  var caller  = credentials(req.body.From);
  // Prepare options for the VoiceIt `GET /sivservice/api/users` API request.
  var options = {
    url: 'https://siv.voiceprintportal.com/sivservice/api/users',
    headers: {
      'VsitEmail'       : caller.email,
      'VsitPassword'    : caller.password,
      'VsitDeveloperId' : context.voiceit.dev_id
    }
  };

  request(options, function (error, response,  body) {
    // When VoiceIt responds with at `200`, we know the user's account profile
    // exists in the VoiceIt system.
    if (!error && response.statusCode == 200) {
      var voiceIt = JSON.parse(body);

      // Let's provide the caller with an opportunity to enroll by typing `1` on
      // their phone's keypad.
      twiml.say('Welcome back. Remain on the line to create an additional enrollment.');
      twiml.redirect('/enroll');

      res.send(twiml.toString());
    } else {
      switch(response.statusCode) {
        // Create a VoiceIt user when the HTTP status is `412 Precondition Failed`.
        case 412:
          // Prepare options for the VoiceIt `POST /sivservice/api/users` API request.
          var options = {
            url: 'https://siv.voiceprintportal.com/sivservice/api/users',
            headers: {
              'VsitDeveloperId' : context.voiceit.dev_id,
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

  twiml.say('Please say your phrase to enroll.');
  twiml.record({
    action    : '/process_enrollment?enrollCount=' + enrollCount,
    maxLength : 5,
    trim      : 'do-not-trim'
  });

  res.send(twiml.toString());
});

app.post('/process_enrollment', function(req, res) {
  var caller       = credentials(req.body.From);
  var enrollCount  = req.query.enrollCount;
  var recordingURL = req.body.RecordingUrl + ".wav";
  // Prepare options for the VoiceIt `POST /sivservice/api/enrollments/bywavurl API request.
  var options      = {
    url: 'https://siv.voiceprintportal.com/sivservice/api/enrollments/bywavurl',
    headers: {
      'VsitDeveloperId' : context.voiceit.dev_id,
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

