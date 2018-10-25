Profile Support
================

If you need to have different configurations for different servers, then profile support may help.
Without specifying any profile the configuration and truststore files are searched for under your
home folder in `.moesol/cac-agent`

If you need a different configuration you can make `cac-agent` search in a sub-directory
by specifying a "profile" name via a system property `com.moesol.agent.profile`.
For example, if you have a different truststore, username, and password for the
foobar server, you can add `-Dcom.moesol.agent.profile=foobar` to the java options
and `cac-agent` will use `~/.moesol/cac-agent/foobar` as the folder for these files:

```
agent.properties
pkcs11.cfg
truststore.jks
```
