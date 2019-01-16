Building cac-agent
========

Setup
--------

To build cac-agent, you must have JDK8 and JDK11 available for compiling.
This allows cac-agent to carry libraries that work with both runtime
environments.

You can specify the paths to these via `~/.m2/settings.xml`:

	<settings>
	  ...
	  <profiles>
	    <profile>
	      <id>cac-agent-variables</id>
	      <!-- Point to your JDK locations -->
	      <properties>
		<JDK_8_HOME>/usr/lib/jvm/java-8-openjdk-amd64</JDK_8_HOME>
		<JDK_11_HOME>/usr/lib/jvm/java-11-openjdk-amd64</JDK_11_HOME>
	      </properties>
	    </profile>
	  </profiles>
	  ...
	 
	  <!-- Activate profile by default (for convenience) -->
	  <activeProfiles>
	    <activeProfile>cac-agent-variables</activeProfile>
	  </activeProfiles>
	</settings>

... or at the time building (via command line args):

	mvn ... -DJDK_8_HOME=/usr/lib/jvm/java-8-openjdk-amd64 -DJDK_11_HOME=/usr/lib/jvm/java-11-openjdk-amd64

Building
--------

Compiling is a simple Maven command:

	mvn clean install

