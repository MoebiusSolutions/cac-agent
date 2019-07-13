cac-agent (Common Access Card Integration for Developers)
================

Overview
----------------

This package has the following major components:

* **cac-ssl-relay**: A local daemon that transparently wraps traffic with a CAC-protected TLS tunnel
	* Client applications can access the remote, CAC-protected services without any direct CAC integration
	* When you connect through this daemon, you're only prompted for a CAC PIN on the first request
	* This works great with private SSL/TLS-protected services including **Git**, **Maven**, **NPM**, and **Docker**
		* In the case of Docker, you'll have to make sure that you [setup local SSL](docs/Using-local-ssl-with-ssl-relay.md) 
		  or else the server can get confused by the transition between HTTP and HTTPS

* **cac-jgit**: A version of the jGit CLI with bundled CAC support
	* This works as a standalone replacement for command line Git, without the need for **cac-ssl-relay**
	* Note that jGit is missing a handful of convenience commands, such as `git pull` (instead you have to run `jgit fetch` then `git merge ...` explicitly).

> NOTE: If you are just looking for CAC integration for `git` on Windows, you might try `Github Desktop`. It integrates with the 
> Windows Certifcate Manager. Thus, if your CAC is already configured and working for IE/Edge, it should work with `Github Desktop`.
> To prevent `Github Desktop` from chaning LF to CRLF on checkout you can configure git:

     git config core.eol lf
     git config core.autocrlf input

* **cac-agent**: A generalized CAC integration for Java
	* You can use this libary to add a Swing-popup or CLI-prompt to select/use a CAC certificate for SSL (HTTPS) operations
	  This especially useful if your card has more than one certificate, otherwise Java always uses the first certificate.
	* The apps above depend upon this library
	* This library is available from the [cac-agent Maven repo](https://github.com/MoebiusSolutions/cac-agent.mvn.git)


Quick Start
----------------

Setup cac-agent (required for **cac-ssl-relay** and **cac-jgit**):

1. Ensure that you're running JRE 8 or 10+ (9 may not work)
2. Download the the latest binary from the [GitHub Maven repo](https://github.com/MoebiusSolutions/cac-agent.mvn/tree/master/com/github/MoebiusSolutions).
	* **cac-ssl-relay**: Get the `cac-ssl-relay-XXX-jar-with-dependencies.jar` file
	* **cac-jgit**: Get the `cac-jgit-XXX-jar-with-dependencies.jar` file
3. [Create the cac-agent Truststore](docs/Create-the-cac-agent-Truststore.md)
4. Configure
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

* Build Status: [![CircleCI](https://circleci.com/gh/MoebiusSolutions/cac-agent.svg?style=svg)](https://circleci.com/gh/MoebiusSolutions/cac-agent)
* [Building cac-agent](Building-cac-agent.md)
* [Tagging/Deploying a cac-agent Release](docs/Tagging-Deploying-a-cac-agent-Release.md)
