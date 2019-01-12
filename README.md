cac-agent (Common Access Card Integration for Developers)
================

Overview
----------------

This package has the following major components:

* **cac-ssl-relay**: A local daemon that transparently wraps traffic with a CAC-protected TLS tunnel
	* Client applications can access the remote, CAC-protected services without any direct CAC integration
	* When you connect through this daemon, you're only prompted for a CAC PIN on the first request
	* This works great with private SSL-protected web services including **Git**, **Maven**, **NPM**, and **Docker**
		* In the case of Docker, you'll have to make sure that you [setup local SSL](docs/Using-local-ssl-with-ssl-relay.md) or else the server can get confused by the transition between HTTP and HTTPS

* **cac-jgit**: A version of the jGit CLI with bundled CAC support
	* This works as a standalone replacement for command line Git, without the need for **cac-ssl-relay**
	* Note that jGit is missing a handful of convenience commands, such as `git pull` (instead you have to run `git fetch` then `git merge ...` explicitly).

* **cac-agent**: A generalized CAC integration for Java
	* You can use this libary to add a Swing-popup or CLI-prompt to select/use a CAC certificate for SSL (HTTPS) operations
	* The apps above depend upon this library
	* This library is available from the [cac-agent Maven repo](https://github.com/MoebiusSolutions/cac-agent.mvn.git)


Build Status
----------------

[![CircleCI](https://circleci.com/gh/MoebiusSolutions/cac-agent.svg?style=svg)](https://circleci.com/gh/MoebiusSolutions/cac-agent)


Quick Start
----------------

Setup cac-agent (required for **cac-ssl-relay** and **cac-jgit**):

1. Download the the latest binary from the [GitHub Maven repo](https://github.com/MoebiusSolutions/cac-agent.mvn/tree/master/com/github/MoebiusSolutions).
	* **cac-ssl-relay**: Get the `cac-ssl-relay-XXX-jar-with-dependencies.jar` file
	* **cac-jgit**: Get the `cac-jgit-XXX-jar-with-dependencies.jar` file
2. [Create the cac-agent Truststore](docs/Create-the-cac-agent-Truststore.md)
3. Configure
	* [Configure cac-agent for Linux](docs/Configure-cac-agent-for-Linux.md)
	* [Configure cac-agent for Windows](docs/Configure-cac-agent-for-Windows.md)

Using cac-agent:

* [Using cac-jgit](docs/Using-cac-agent-with-Git.md)
* [Using cac-ssl-relay](docs/Using-cac-agent-with-ssl-relay.md)


Other Notes
----------------

* [Text-Only Mode](docs/Text-Only-Mode.md) (instead of a the graphical interface)
* [Storing Username/Password](docs/Storing-Username-Password.md) (skipping prompt)
* [Setting Up PKCS11 CAC Drivers in Ubuntu 16](docs/Setting-Up-PKCS11-CAC-Drivers-in-Ubuntu-16.md)
* [Profile Support](docs/Profile-Support.md) (multiple cac-agent configurations)
* [Using cac-agent with Older JGit Releases](docs/Using-cac-agent-with-Older-JGit-Releases.md)


Notes to cac-agent Developers
----------------

* [Tagging/Deploying a cac-agent Release](docs/Tagging-Deploying-a-cac-agent-Release.md)
