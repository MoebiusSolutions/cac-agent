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

Configuration Directory Support
===============================

If you would rather put the configuration directory into a specific directory instead
of having it under your home folder then you can give the absolute path to the configuration
directory using the Java system property `com.moesol.agent.config`. For example,

```
-Dcom.moesol.agent.config=/home/user/jgit-cac/configuration
```

This form is useful if you have a configuration with a `pkcs11.cfg` and a `truststore.jks` that you would like
to zip up and share. 

> Note, be sure to remove your saved credentials in `agent.properties` before you share it.

Option Precedence
=================

If both `com.moesol.agent.config` and `com.moesol.agent.profile` are specified `com.moesol.agent.config`,
then `com.moesol.agent.config` takes precedence and `com.moesol.agent.profile` is ignored.
