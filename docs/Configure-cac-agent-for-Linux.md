Configure cac-agent for Linux
================


(This was tested against Ubuntu 16 and 18.)


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

... replacing `/usr/lib64/pkcs11/libcoolkeypk11.so` with your chosen middleware.
The [previously referenced guide](Setting-Up-PKCS11-CAC-Drivers-in-Ubuntu-16.md) enumerates these options:

* (for original coolkey): `/usr/lib/pkcs11/libcoolkeypk11.so`
* (for coolkey with 64-bit fix): `/usr/lib64/pkcs11/libcoolkeypk11.so`
* (for opensc): `/usr/lib/x86_64-linux-gnu/opensc-pkcs11.so`
* (for safenet): `/usr/lib/libeTPkcs11.so`

## Configuring Support for Multiple Slots

Version `cac-agent-1.12` adds support for multiple slots. It now loads multiple `pkcs11.{1-n}.cfg`
files. For backward compatibility `pkcs11.cfg` is the first file loaded and the first slot
checked for a valid token. Additionally, the sequence of files starting with `pkcs11.1.cfg`, 
`pkcs11.2.cfg`, `pkcs11.3.cfg`, ... are loaded if present. You can use this feature to configure
multiple providers or multiple slots for the same providers. For example, the test system has
two smartcard readers installed. If the first reader is used then the provider software uses
`slotListIndex` of `0`. If the second reader is used then the provider software must be configured
with `slotListIndex` of `1`. Prior to this upgrade you would have had to edit the `pkcs11.cfg`
file to match which slot you were using. Now, you can have two files:

1. `pkcs11.cfg`

```
library=/usr/lib/libeTPkcs11.so
name="SafeNet/slot0"
slotListIndex=0
```

2. `pkcs11.1.cfg`

```
library=/usr/lib/libeTPkcs11.so
name="SafeNet/slot1"
slotListIndex=1
```
