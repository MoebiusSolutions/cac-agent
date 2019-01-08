Using cac-ssl-relay
================

Motivation
----------------

While setting up `jgit` has allowed us to use CAC protected git repositories,
similar work must be repeated when using CAC protected mvn repositories.
Furthermore, there are non-Java based tools that we would like to use with
CAC protected repositories, such as npm and docker. Those tools are not
Java based so we would potentially have to recompile parts of those tools
so that their network stacks are CAC aware.

Since, we already have CAC working with Java, we decided to create a network
tunnel/port forwarder/relay. It turns out that creating a relay in Java
is pretty simple.


Configuring cac-ssl-relay
----------------

cac-ssl-relay is configured through the `agent.properties` file:

	# Windows
	%USERPROFILE%\.moesol\cac-agent\agent.properties

	# Linux
	~/.moesol/cac-agent/agent.properties

Within `agent.properties`, we define relay bindings with the `relay.` prefix. 
The rest of the property name is the `bindHostname:bindPort`. The value
of the property is the `targetHostname:targetPort` to relay/forward to.

For example, suppose you have four CAC protected services:

1. `https://cac-required.git.server.org`
2. `https://cac-required.mvn.server.org`
3. `https://cac-required.docker.server.org`
4. `https://cac-required.npm.server.org`

You would add the following to your operating systems' `hosts` file (`/etc/hosts` in Linux, and `C:\Windows\System32\drivers\etc\hosts` in Windows):

	127.0.0.5 git-local
	127.0.0.6 mvn-local
	127.0.0.7 docker-local
	127.0.0.8 npm-local

Then you would add the following to your `agent.properties`:

	relay.git-local\:9090=cac-required.git.server.org:443
	relay.mvn-local\:9090=cac-required.mvn.server.org:443
	relay.docker-local\:9090=cac-required.docker.server.org:443
	relay.npm-local\:9090=cac-required.npm.server.org:443

**NOTE**: The `\:` is required to prevent the Java properties parser from using just
`relay.git-local` as the key instead of what we need which is `relay.git-local:9090`.

With this configuration (and `cac-ssl-relay` running), you would see cac-ssl-relay listening on port 9090.
HTTP requests sent to this port are routed according to requested hostname.

So, if you submit a curl command to `http://git-local:9090/`, cac-ssl-relay will read "git-local:9090"
from the request headers, and relay the request to `https://cac-required.git.server.org` (after applying a CAC-enabled SSL wrapper). 


Locating the Executable Jar
----------------

You should have a version of this executable jar (available [here](https://github.com/MoebiusSolutions/cac-agent.mvn/tree/master/com/github/MoebiusSolutions)):

	cac-ssl-relay-XXX-jar-with-dependences.jar


Executing cac-ssl-relay
----------------

We can simply execute the cac-ssl-relay jar to open the relay:

	java -jar cac-ssl-relay-XXX-jar-with-dependences.jar

The first time each service is hit, the user will be prompted for their CAC PIN.


Example URL for Git
----------------

You could use the standard (non-CAC) git command to clone through the relay via:

	git remote clone http://git-local:9090/same/path/as/without/relay/project.git


Local SSL (Local HTTPS)
----------------

By default, all cac-ssl-relay listens for non-ssl (non-HTTPS) requests.

See [Using Local SSL (Local HTTPS) with cac-ssl-relay](Using-local-ssl-with-ssl-relay.md)
to add encryption between client app and the SSL relay.


Auto-Restart
----------------

If you want to auto-restart the ssl relay after an error you can use this short bash script:

	#!/bin/bash
	
	# trap ctrl-c and call ctrl_c()
	trap ctrl_c INT
	
	function ctrl_c() {
		echo "** Trapped CTRL-C"
		exit 0
	}
	
	while true; do
	  java \
	    -Djavax.net.ssl.keyStoreType=pkcs12 \
	    -Djavax.net.ssl.keyStore=certs/me.p12 \
	    "$@" -jar cac-ssl-relay-XXX-jar-with-dependences.jar; 
	done
