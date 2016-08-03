Biometric Callbox
=================

Concept: You want high-tech biometric authentication for your building. But all you have is a phone line to the door and a stupid call box. Sorry, no retinal scanners, keypads, prox cards, etc. Just a phone. But we are just fine, because we can analyze the tone and cadence of your voice, plus the phrase you speak, to determine securely whether or not you should be allowed in.

Dependencies
------------

* Twilio
* IBM Watson speech-to-text API
* VoiceIt biometric authentication API

Running
-------

1. Install npm dependencies: `npm install`
2. Clone the sample config file: `cp config.json.sample config.json`
3. Edit `config.json` and fill in all required fields.  Make sure to specify the base URL.
4. Run with `node server.js`

