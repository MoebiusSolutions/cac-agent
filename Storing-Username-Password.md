Storing Username/Password
================

Plaintext Username/Password
----------------

If you want to store your username/password so that you don't
have to enter them on every git command, simply add them to
`~/.moesol/cac-agent/agent.properties` (or `%USERPROFILE%\.moesol\cac-agent\agent.properties` on Windows):

	user: XXXX
	password: XXXX


Encrypted Username/Password
----------------

If you're into security theater, you can encrypt your git password using
a "master" password. This ensures that your git password isn't
"stored in plain text", but it is stored next
to the master password, which is in plain text. (High-fives!)

To generate the encrypted form of your password, run:

	cac-git --cac-agent-encrypt

Then enter your git password and a new master password.

Then add your encrypted git password and master password to `agent.properties`:

	user: XXXX
	password: <output-of-command>
	master: XXXX

