Using cac-jgit
================


Locating the Executable Jar
----------------

You should have a version of this executable jar (available [here](https://github.com/MoebiusSolutions/cac-agent.mvn/tree/master/com/github/MoebiusSolutions)):

	cac-jgit-XXX-jar-with-dependences.jar


Using cac-jgit
----------------

The Now we can simply call the cac-agent jar as if it were the jgit executable:

	# All excutions take this form:
	java -jar cac-jgit-XXX-jar-with-dependences.jar <git commands>

	# For example:
	java -jar cac-jgit-XXX-jar-with-dependences.jar clone https://our-server.gov/repo.git

**IMPORTANT NOTE**: Our current git servers generally respond with this prompt:

	Username for https://user@our-server.gov/repo.git/info/refs?service=git-upload-pack: 

**Just press ENTER to skip this prompt**, which will be followed by a different username/password prompt (which actually works):

	Username: user
	Password: 
