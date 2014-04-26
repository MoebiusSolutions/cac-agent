# mscapi-agent

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
	-javaagent:"$dir"/mscapi-agent.jar=load \
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
	-javaagent:c:/Programs/mscapi-agent.jar=load
	-Dosgi.requiredJavaVersion=1.6
	-Xms40m
	-Xmx1024m


[1]: https://www.moesol.com/roller/rhastings/entry/inject_a_cac_identity_chooser

# sslVerify=false

If you set [http] sslVerify=false, you will cause jgit to setup a custom SSL context which will bypass
the SSL context that the cac-agent sets up. Most likey resulting in a SSL handshake_error.

