cac-agent (Common Access Card (CAC) integration for Developers)
================

Overview
----------------

This package has the following major components:

* **cac-ssl-relay**: A local daemon that can be used to "relay" traffic to remote, CAC-protected endpoints
	* Client applications can access the remote, CAC-protected services without any direct CAC integration
	* When you connect through this daemon, you're only prompted for a CAC PIN on the first request
	* This works great with private SSL-protected repos including **Git**, **Maven**, **NPM**, and **Docker**
		* In the case of Docker, you'll have to make sure that you [setup local SSL](Using-local-ssl-with-ssl-relay.md) or else the server can get confused by the transition between HTTP and HTTPS

* **cac-jgit**: A version of jGit with bundled CAC support
	* This works as a standalone replacement for command line Git, without the need for **cac-ssl-relay**
	* Note that jGit is missing a handful of convenience commands, such as `git pull` (instead you have to run `git fetch` then `git merge ...` explicitly).

* **cac-agent**: A generalized CAC integration for Java
	* You can use this libary to add a Swing-popup or CLI-prompt to select/use a CAC certificate for SSL (HTTPS) operations
	* The aforementioned apps were developed on top of this


Build Status
----------------

[![CircleCI](https://circleci.com/gh/MoebiusSolutions/cac-agent.svg?style=svg)](https://circleci.com/gh/MoebiusSolutions/cac-agent)


Quick Start
----------------

Setup cac-agent (required for **cac-ssl-relay** and **cac-jgit**):

1. [Compile cac-agent](Compile-cac-agent.md)
	* ... or download from [GitHub releases](https://github.com/MoebiusSolutions/cac-agent/releases).
2. [Create the cac-agent Truststore](Create-the-cac-agent-Truststore.md)
3. Configure
	* [Configure cac-agent for Linux](Configure-cac-agent-for-Linux.md)
	* [Configure cac-agent for Windows](Configure-cac-agent-for-Windows.md)

Using cac-agent:

* [Using cac-jgit](Using-cac-agent-with-Git.md)
* [Using cac-ssl-relay](Using-cac-agent-with-ssl-relay.md)


Other Notes
----------------

* [Text-Only Mode](Text-Only-Mode.md) (instead of a the graphical interface)
* [Storing Username/Password](Storing-Username-Password.md) (skipping prompt)
* [Setting Up PKCS11 CAC Drivers in Ubuntu 16](Setting-Up-PKCS11-CAC-Drivers-in-Ubuntu-16.md)
* [Profile Support](Profile-Support.md) (configurations per remote server)
* [Using cac-agent with Older JGit Releases](Using-cac-agent-with-Older-JGit-Releases.md)
