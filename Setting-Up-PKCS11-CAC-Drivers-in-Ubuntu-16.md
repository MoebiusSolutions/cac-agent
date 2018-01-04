Setting Up PKCS11 CAC Drivers in Ubuntu 16
================


Links
----------------

These are links from DISA that helped with Firefox:

* [CAC - Linux](http://iase.disa.mil/pki-pke/getting_started/Pages/linux.aspx)
	* [CAC - Getting Started with Firefox on Linux](http://iase.disa.mil/pki-pke/getting_started/Pages/linux-firefox.aspx)

This is a link from Ubuntu that helped with Chrome:

* [Common Access Card](https://help.ubuntu.com/community/CommonAccessCard)


Which Middleware Library?
----------------

Coolkey

* Stable in firefox/chrome (unlike OpenSC)
* Works with all government-issued CACs we've tried
* Doesn't work with any retail CACs we've tried (PIVkey, Yubikey, etc)

OpenSC

* Expected to be the future of CAC support for RHEL
* Available on Windows too
* Unstable in firefox/chrome, but generally stable with command line tools
* Works with all government-issued and retail CACs we've tried

NOTE: You can install both middlwares and selectively use as desired.


Install Middlware
----------------

Install "pcsc":

	sudo apt-get install pcscd pcsc-tools coolkey

Then install one or both of the middleware libraries:

	sudo apt-get install coolkey
	sudo apt-get install opensc

You can verify that your CAC read is working by lauching:

	pcsc_scan

... and watching for activity as you insert/remove your CAC.


Setup Firefox
----------------

### Fix Coolkey vs 64-bit Firefox

While coolkey used to work without problems (from ```/usr/lib/pkcs11/libcoolkeypk11.so```), it recently started failing
(same OS--still Ubuntu 16.04). The workaround is to add a symlink from a ```lib64``` path:

	sudo ln -s /usr/lib/pkcs11/libcoolkeypk11.so /usr/lib64/pkcs11/libcoolkeypk11.so

No telling how this will change in the future, so you probably want to skip this step and come back if things fail.


### Add Smart Card Device to Firefox

To add a smart card device to Firefox:

* Click the main button, then "Preferences"
* Search for "Devices", click "Security Devices..." button
* Click the "Load" button
	* Set the "Module Name" (```Coolkey``` or ```OpenSC``` works nicely)
	* Set "Module filename" to...
		* (for original coolkey): ```/usr/lib/pkcs11/libcoolkeypk11.so```
		* (for coolkey with 64-bit fix): ```/usr/lib64/pkcs11/libcoolkeypk11.so```
		* (for opensc): ```/usr/lib/x86_64-linux-gnu/opensc-pkcs11.so```


Setup Chrome (NSS)
----------------

Chrome uses NSS for security devices. By configuring NSS, we're actually enabling CAC support in other Ubuntu subsystems as well.

Install NSS modules:

	sudo apt-get install libnss3-tools

Move to home directory:

	cd ~/

Install the middleware library as a security device provider:

* (for original coolkey): ```modutil -dbdir sql:.pki/nssdb/ -add "CAC Module" -libfile /usr/lib/pkcs11/libcoolkeypk11.so```
* (for coolkey with 64-bit fix): ```modutil -dbdir sql:.pki/nssdb/ -add "CAC Module" -libfile /usr/lib64/pkcs11/libcoolkeypk11.so```
* (for opensc): ```modutil -dbdir sql:.pki/nssdb/ -add "CAC Module" -libfile /usr/lib/x86_64-linux-gnu/opensc-pkcs11.so```

Verify the module was added:

	modutil -dbdir sql:.pki/nssdb/ -list

