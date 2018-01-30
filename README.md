cac-agent (CAC Integration with Java and Git)
================

This is useful when you need to select which certificate
you want to pass as your client identity when using
SSL. By default Java passes the first certificate in the
store. However, with CAC Cards and the Windows-KEY store
the first certificate is often not the certificate you
want to use. This agent hooks SSL and presents a Swing
Dialog allowing you to pick which certificate you want
to use.

* ```cac-agent-...jar``` is a library that can be used with arbitrary Java applications.

* ```cac-agent-...-with-dependencies.jar``` executable jar that contains both jgit and cac-agent.


Quick Start
----------------

Setup cac-agent

1. [Compile cac-agent](Compile-cac-agent.md)
2. [Create the cac-agent Truststore](Create-the-cac-agent-Truststore.md)
3. Configure
	* [Configure cac-agent for Linux](Configure-cac-agent-for-Linux.md)
	* [Configure cac-agent for Windows](Configure-cac-agent-for-Windows.md)

Using cac-agent

* [Using cac-agent with Git](Using-cac-agent-with-Git.md)


Other Notes
----------------

* [Text-Only Mode](Text-Only-Mode.md) (instead of a the graphical interface)
* [Setting Up PKCS11 CAC Drivers in Ubuntu 16](Setting-Up-PKCS11-CAC-Drivers-in-Ubuntu-16.md)
* [Using cac-agent with Older JGit Releases](Using-cac-agent-with-Older-JGit-Releases.md)
