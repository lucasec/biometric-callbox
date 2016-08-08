Biometric Callbox
=================

Concept: You want high-tech biometric authentication for your building. But all you have is a phone line to the door and a stupid call box. Sorry, no retinal scanners, keypads, prox cards, etc. Just a phone. But we are just fine, because we can analyze the tone and cadence of your voice, plus the phrase you speak, to determine securely whether or not you should be allowed in.

Dependencies
------------

* Twilio
* IBM Watson speech-to-text API
* VoiceIt biometric authentication API
* Node.JS
* Python (built against 2.7x)

Running
-------

1. Install npm dependencies: `npm install`
2. Install python dependencies: `pip install fuzzywuzzy fuzzysearch`
3. Install SoX (on OS X, run `brew install sox`)
4. Clone the sample config file: `cp config.json.sample config.json`
5. Make the recordings directory: `mkdir recordings`
6. Edit `config.json` and fill in all required fields.  Make sure to specify the base URL.
7. Run with `node server.js`

Usage
-----

First, you need to enroll some voice samples. Configure a Twilio number for `http://MY_APP_BASE_URL/incoming_call`.  Call this number from a phone number registered in the `users` section of `config.json`.

You'll be asked to say a phrase three times. Pick one of the phrases supported by the VoiceIt API and repeat this back as prompted. Once enrolled, you can call this number back to create additional enrollments if necessary (which may improve accuracy).

To test the authentication, configure a number for `http://MY_APP_BASE_URL/authenticate`.  Call from any number.  This time, you'll be asked to state your combined phrase (the VoiceIt phrase, plus your personal prefix/suffix configured in `config.json`).
