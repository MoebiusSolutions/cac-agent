Tagging/Deploying a cac-agent Release
========

Overview
--------

For cac-agent, we use Maven to:

* Tag a release (roll maven versions, tag source, and push to github)
* Deploy a release (build the jars, and push the maven artifacts to a [github repo](https://github.com/MoebiusSolutions/cac-agent.mvn.git) that acts like a maven repo)


Setting Up GitHub Credentials
--------

Before you can tag/deploy a release of cac-agent, you have to get write
permission to these two repos:

* [cac-agent](https://github.com/MoebiusSolutions/cac-agent.git)
* [cac-agent.mvn](https://github.com/MoebiusSolutions/cac-agent.mvn.git)

Then you can add your github credentials to a `github` server,
in your maven config (`~/.m2/settings.xml`):

	<settings>
		<servers>
			<server>
				<id>github</id>
				<username>USERNAME</username>
				<password>PASSWORD</password>
			</server>
		</servers>
	</settings>

If you happen to use 2-factor authentication to github,
you can create a Personal Access Token, then provide this
as a password (in which case you don't need a username):

	<settings>
		<servers>
			<server>
				<id>github</id>
				<password>PERSONAL_ACCESS_TOKEN</password>
			</server>
		</servers>
	</settings>

When creating a github PAT, you'll need to grant the following permissions:

	repo:status
	repo_deployment
	public_repo
	user:email


Setting Up Maven Central
--------

The `com.github.github:site-maven-plugin` that this project uses doesn't
appear to be available in the default Maven Central repo. Instead, I had
to add jCenter to my general-purpose Maven proxy server. You may need
to do this to your Maven proxy server, or you local `settings.xml` file.

Here's the repo I added (which is a recommended superset of Maven Central):

	https://jcenter.bintray.com/


Tagging/Deploying a Release
--------

Before deploying, make sure the build works:

	mvn clean install

Here's how I generally tag/deploy the next release of cac-agent:

	# Tag/push the next version
	mvn clean -B release:prepare

	# Build/deploy the tagged version
	# (depends upon temporary files from pervious command)
	mvn -B release:perform

If we ever need to re-deploy a previously tagged release (the second step above),
we can do this via:

	git checkout cac-agent-1.12
	mvn clean deploy


Accessing the Resulting Maven Artifacts
--------

Users of our deployed artifacts can get to them by adding this to their
list of Maven artifact repos:

	<repositories>
		<repository>
			<id>cac-agent</id>
			<url>https://raw.github.com/MoebiusSolutions/cac-agent.mvn/master/</url>
		</repository>
	</repositories>

