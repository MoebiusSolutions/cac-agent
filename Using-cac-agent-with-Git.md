Using cac-jgit
================


Locating the Executable Jar
----------------

If you built cac-agent from source, you'll find the cac-jgit executable jar here:

	./cac-jgit/target/cac-jgit.jar

Alternatively, you can download this directly from the releases page on GitHub.


Using cac-jgit
----------------

The Now we can simply call the cac-agent jar as if it were the jgit executable:

	# All excutions take this form:
	java -jar cac-jgit.jar <git commands>

	# For example:
	java -jar cac-jgit.jar clone https://our-server.gov/repo.git

**IMPORTANT NOTE**: Our current git servers generally respond with this prompt:

	Username for https://user@our-server.gov/repo.git/info/refs?service=git-upload-pack: 

**Just press ENTER to skip this prompt**, which will be followed by a different username/password prompt (which actually works):

	Username: user
	Password: 
