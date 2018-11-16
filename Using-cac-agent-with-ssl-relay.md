# Using cac-agent with Java SSL-Relay

## Motivation

While setting up `jgit` has allowed us to use CAC protected git repositories,
similar work must be repeated when using CAC protected mvn repositories.
Furthermore, there are non-Java based tools that we would like to use with
CAC protected repositories, such as npm and docker. Those tools are not
Java based so we would potentially have to recompile parts of those tools
so that their network stacks are CAC aware.

Since, we already have CAC working with Java, we decided to create a network
tunnel/port forwarder/relay. It turns out that creating a relay in Java
is pretty simple.

## Details

`cac-aware-ssl-relay-jar-with-dependencies.jar` is a simple network relay.
It uses entries in `agent.properties` with the `relay.` prefix to configure each relay. 
The rest of the property name is the `bindHostname:bindPort`. The value
of the property is the `targetHostname:targetPort` to relay/forward to.

For example, suppose you have four CAC protected services:

1. `https://cac-required.git.server.org`
2. `https://cac-required.mvn.server.org`
3. `https://cac-required.docker.server.org`
4. `https://cac-required.npm.server.org`

You would add the following to your `/etc/hosts` file

```
127.0.0.1 git-local
127.0.0.2 mvn-local
127.0.0.3 docker-local
127.0.0.4 npm-local
```

Then in your `agent.properties` you would add

```
relay.git-local\:9090=cac-required.git.server.org:443
relay.mvn-local\:9090=cac-required.mvn.server.org:443
relay.docker-local\:9090=cac-required.docker.server.org:443
relay.npm-local\:9090=cac-required.npm.server.org:443
```

Note that the `\:` is required to prevent the Java properties parser from using just
`relay.git-local` as the key instead of what we need which is `relay.git-local:9090`.

Next, you would run 

```
java -jar target/cac-aware-ssl-relay-jar-with-dependencies.jar
```

Now, you can point your development tools at your local ports:

```
git remote add relay http://git-local:9090/same/path/as/without/relay/project.git
```

Running fetch as shown below will `git fetch` from the CAC protected server.
Note: Be sure the relay is running before you fetch.

```
git fetch relay
```

The above will trigger the Swing user interface to prompt for you PIN. You may also have to login
using the username and password you have setup on your git server (but that can be one-time
if you have setup git to cache usernames and passwords). And, then it will fetch from the CAC
protected server.

Similarly, setup your maven repository to use `http://mvn-local:9090/same/path/as/without/relay`.
Now, the next mvn download triggered will be through the relay and prompt you for your PIN
if it needs it. Any downloads will be downloaded from the CAC protected server after the ssl-relay
has presented the server with your CAC identity and validated it.
