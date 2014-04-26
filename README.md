# cac-agent

This project is the source code for this [blog entry][1].
It is useful when you need to select which certificate
you want to pass as your client identity when using
SSL. By default Java passes the first certificate in the
store. However, with CAC Cards and the Windows-KEY store
the first certificate is often not the certifcate you
want to use. This agent hooks SSL and presents a Swing
Dialog allowing you to pick which certificate you want
to use.

The startup code for jgit.sh is a good example of using
this agent:

	#!/bin/sh
	# Git bash
	
	dir="$(cd "$(dirname "$0")" && pwd -W)"
	
	java \
	-Xmx512m \
	-javaagent:"$dir"/cac-agent.jar=load \
	-jar "$dir"/jgit-cli.jar $@

Another example is setting up Eclipse to use this agent
which hooks into the internal jgit inside of Eclipse.

	-startup
	plugins/org.eclipse.equinox.launcher_1.3.0.v20130327-1440.jar
	--launcher.library
	plugins/org.eclipse.equinox.launcher.win32.win32.x86_64_1.1.200.v20130521-0416
	-product
	org.eclipse.epp.package.standard.product
	--launcher.defaultAction
	openFile
	--launcher.XXMaxPermSize
	256M
	-showsplash
	org.eclipse.platform
	--launcher.XXMaxPermSize
	256m
	--launcher.defaultAction
	openFile
	--launcher.appendVmargs
	-vm
	C:/Programs/Java/jdk1.7.0_51/jre/bin
	-vmargs
	-javaagent:c:/Programs/cac-agent.jar=load
	-Dosgi.requiredJavaVersion=1.6
	-Xms40m
	-Xmx1024m


# Windows Key/Trust Store Integration

On Windows this agent sets up the Windows-MY keystore so that Java can
integration with Windows. If you have your CAC working with IE or Chrome then
Java will be able to share this configuration. You can also configure to use
the Windows trust store.

# Linux PKCS#11 Integration and JKS Based Trust Store

On Linux this agent sets up a PKCS#11 provider. For Ubuntu, this [cac help document][2]
was a pretty good guide for getting CAC setup and working. Apparently RHEL,
includes a working PKCS#11 libcackey.so file out of the box so the above
information may not be needed on RHEL.

Rather than require you to modify your Java installation to statically
configure a PKCS#11 provider, this agent looks for this file:

	${user.home}/.moesol/cac-agent/pkcs11.cfg
	
The contents of this file should setup the PKCS#11 provider. For Ubuntu, this
configuration works:

	library=/usr/local/lib/libcackey.so
	name="CAC Key"
	
To date, we have not been able to get the NSS provider working so that you
could have Java share the Firefox or Chrome key/trustsore. Instead, this
agent looks for this file:

	${user.home}/.moesol/cac-agent/truststore.jks
	
If it exists, it sets `javax.net.ssl.trustStore` to point at the file.
The net result is that to configure cac-agent on Ubuntu you need to create
two files

1. ${user.home}/.moesol/cac-agent/pkcs11.cfg
2. ${user.home}/.moesol/cac-agent/truststore.jks

There are example files for both of these in the project root directory. If you
upgrade Java cac-agent should continue to work since the CAC configuration
information is stored in your home directory.

# sslVerify=false

If you set [http] sslVerify=false, you will cause jgit to setup a custom SSL context which will bypass
the SSL context that the cac-agent sets up. Most likey resulting in a SSL handshake_error.

[1]: https://www.moesol.com/roller/rhastings/entry/inject_a_cac_identity_chooser
[2]: https://help.ubuntu.com/community/CommonAccessCard
