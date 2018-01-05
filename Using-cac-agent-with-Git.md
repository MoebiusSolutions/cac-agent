Using cac-agent with Git
================


(Linux) Create a Wrapper Script
----------------

It's a lot more convenient to use an executable script than call the jar directly, so let's create the script:

	sudo vi /usr/local/bin/cac-git

... with contents (replacing ```~/Downloads/cac-agent/target/cac-agent-...-jar-with-dependencies.jar``` with your executable jar path):

	#!/bin/bash

	java -jar ~/Downloads/cac-agent/target/cac-agent-...-jar-with-dependencies.jar $*

And set the permissions appropriately:

	sudo chown root:root /usr/local/bin/cac-git
	sudo chmod 755 /usr/local/bin/cac-git


(Windows) Create a Wrapper Script
----------------

It's a lot more convenient to use an executable script than call the jar directly, so let's create the script:

	notepad "%USERPROFILE%\cac-git.cmd"

... with contents (replacing ```"%USERPROFILE%/Downloads/cac-agent/target/cac-agent-...-jar-with-dependencies.jar"``` with your executable jar path):

	java -jar "%USERPROFILE%/Downloads/cac-agent/target/cac-agent-...-jar-with-dependencies.jar" %*


Using cac-agent
----------------

Now we can simply call the cac-agent wrapper script as if it were the git executable. For example:

	# Linux
	cac-git clone https://our-server.gov/repo.git
	# Windows
	cac-git.cmd clone https://our-server.gov/repo.git

**IMPORTANT NOTE**: Our current git servers generally respond with this prompt:

	Username for https://user@our-server.gov/repo.git/info/refs?service=git-upload-pack: 

**Just press ENTER to skip this prompt**, which will be followed by a different username/password prompt, that actually works:

	Username: user
	Password: 


