Using Local SSL (Local HTTPS) with cac-ssl-relay
================

Overview
----------------

By default, all cac-ssl-relay listens for non-ssl (non-HTTPS) requests, which means:

* Traffic between your client apps and the local relay daemon are un-encrypted (granted, this is a very short hop)
* The payload of your requests may indicate HTTP while the ultimate server sees an HTTPS wrapper
	* We've seen this break things, noteably Nexus' Docker registry server

To add SSL to the local connection to the cac-ssl-relay, we need to:

1. Load a server certificate into cac-ssl-relay
2. Add trust of the cac-ssl-relay certificate to your client application (git, maven, etc)

We'll cover #1 below, but #2 is beyond the scope of this document.


Generte a Self-Signed Server Certificate for cac-ssl-relay 
----------------

Here's an example of creating a self-signed server certificate `cac-ssl-relay.pfx` (with password `changeit`, which Java uses by default):

	openssl req -x509 -newkey rsa:4096 -keyout cac-ssl-relay.key -out cac-ssl-relay.crt -days 2048 \
	  -passout "pass:changeit" \
	  -subj "/C=US/ST=California/L=San Diego/CN=cac-ssl-relay"

	openssl pkcs12 -export -out cac-ssl-relay.pfx \
	  -inkey cac-ssl-relay.key -in cac-ssl-relay.crt \
	  -passin "pass:changeit" -passout "pass:changeit

We can copy this to an easy-to-find location:

	cp cac-ssl-relay.pfx ~/.moesol/cac-agent/


Update cac-ssl-relay Config
----------------

If you change the `relay.` prefixes to `sslRelay.` in `agent.properties`,
it will listen for local HTTPS connections locally. This must be assigned
to a different local port than the other, non-SSL local connections.
For example:

	relay.git-local\:9090=cac-required.git.server.org:443
	relay.mvn-local\:9090=cac-required.mvn.server.org:443
	# Updated to use local SSL on port 8443
	sslRelay.docker-local\:8443=cac-required.docker.server.org:443
	relay.npm-local\:9090=cac-required.npm.server.org:443



Launch cac-ssl-relay
----------------

Now that cac-ssl-relay is configured to listen for HTTPS requests, it needs to know where
to find it's own certificate/key. We point to the `.pfx` file (`.pfx` is the Java 11 default format) at when launching it:

	java \
	  -Djavax.net.ssl.keyStoreType=pkcs12 \
	  -Djavax.net.ssl.keyStore=~/.moesol/cac-agent/cac-ssl-relay.pfx \
	  jar cac-ssl-relay-XXX-jar-with-dependencies.jar

