Using cac-agent with Older JGit Releases
================

The startup code for jgit.sh is a good example of using
this agent:

	#!/bin/sh
	# Git bash
	
	dir="$(cd "$(dirname "$0")" && pwd -W)"
	
	java \
	-Xmx512m \
	-javaagent:"$dir"/cac-agent.jar=load \
	-jar "$dir"/jgit-cli.jar $@
	
With the above script in place, you can clone a remote repository that
requires a CAC with

    jgit.sh clone <url>

When you are ready to push you can use

    jgit.sh push [repository]
    
Fetching updates

    jgit.sh fetch [repository]
    
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
