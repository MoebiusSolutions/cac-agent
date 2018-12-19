Using Local TLS (Local HTTPS) with cac-tls-relay
================

Overview
----------------

By default, all cac-tls-relay listens for non-tls (non-HTTPS) requests, which means:

* Traffic between your client apps and the local relay daemon are un-encrypted (granted, this is a very short hop)
* The payload of your requests may indicate HTTP while the ultimate server sees an HTTPS wrapper
	* We've seen this break things, noteably Nexus' Docker registry server

To add TLS to the local connection to the cac-tls-relay, we need to:

1. Load a server certificate into cac-tls-relay
2. Add trust of the cac-tls-relay certificate to your client application (git, maven, etc)

We'll cover #1 below, but #2 is beyond the scope of this document.


Generte a Self-Signed Server Certificate for cac-tls-relay 
----------------

Here's an example of creating a self-signed server certificate `cac-tls-relay.pfx` (with password `changeit`, which Java uses by default):

	openssl req -x509 -newkey rsa:4096 -keyout cac-tls-relay.key -out cac-tls-relay.crt -days 2048 \
	  -passout "pass:changeit" \
	  -subj "/C=US/ST=California/L=San Diego/CN=cac-tls-relay"

	openssl pkcs12 -export -out cac-tls-relay.pfx \
	  -inkey cac-tls-relay.key -in cac-tls-relay.crt \
	  -passin "pass:changeit" -passout "pass:changeit

We can copy this to an easy-to-find location:

	cp cac-tls-relay.pfx ~/.moesol/cac-agent/


Update cac-tls-relay Config
----------------

If you change the `relay.` prefixes to `sslRelay.` in `agent.properties`,
it will listen for local HTTPS connections locally. This must be assigned
to a different local port than the other, non-TLS local connections.
For example:

	relay.git-local\:9090=cac-required.git.server.org:443
	relay.mvn-local\:9090=cac-required.mvn.server.org:443
	# Updated to use local TLS on port 8443
	sslRelay.docker-local\:8443=cac-required.docker.server.org:443
	relay.npm-local\:9090=cac-required.npm.server.org:443



Launch cac-tls-relay
----------------

Now that cac-tls-relay is configured to listen for HTTPS requests, it needs to know where
to find it's own certificate/key. We point to the `.pfx` file at when launching it:

	java \
	  -Djavax.net.ssl.keyStoreType=pkcs12 \
	  -Djavax.net.ssl.keyStore=~/.moesol/cac-agent/cac-tls-relay.pfx \
	  jar target/cac-tls-relay.jar

