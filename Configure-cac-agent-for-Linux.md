Configure cac-agent for Linux
================


(This was tested against Ubuntu 16.)


Install CAC Drivers
----------------

Install your appropriate CAC middleware. You can use [Setting Up PKCS11 CAC Drivers in Ubuntu 16](Setting-Up-PKCS11-CAC-Drivers-in-Ubuntu-16.md) as a guide, but you can skip the browser setup sections.


Configure cac-agent Middleware
----------------

Create config dir:

	mkdir -p ~/.moesol/cac-agent/

Specify CAC middlware by creating:

	vi ~/.moesol/cac-agent/pkcs11.cfg

... with contents:

	library=/usr/lib64/pkcs11/libcoolkeypk11.so
	name="CAC Key"

... replacing ```/usr/lib64/pkcs11/libcoolkeypk11.so``` with your chosen middleware.
The [previously reference guide](Setting-Up-CAC-Smart-Card-in-Ubuntu-16.md) enumerates these options:

* (for original coolkey): ```/usr/lib/pkcs11/libcoolkeypk11.so```
* (for coolkey with 64-bit fix): ```/usr/lib64/pkcs11/libcoolkeypk11.so```
* (for opensc): ```/usr/lib/x86_64-linux-gnu/opensc-pkcs11.so```
