Building cac-agent
========

Setup
--------

To build cac-agent, you must have JDK8 and JDK11 available for compiling.
This allows cac-agent to carry libraries that work with both runtime
environments.

The version of `java` and `javac` in your default path can be any version 8 or greater.

## Using maven tool chains to define required jdk locations

You can specify the paths to JDK8 and JDK11 via `~/.m2/toolchains.xml`:

	<?xml version="1.0" encoding="UTF8"?>
	<toolchains>
		<toolchain>
			<type>jdk</type>
			<provides>
				<version>8</version>
				<vendor>openjdk</vendor>
			</provides>
			<configuration>
				<jdkHome>/usr/lib/jvm/java-8-openjdk-amd64/</jdkHome>
			</configuration>
		</toolchain>
		<toolchain>
			<type>jdk</type>
			<provides>
				<version>11</version>
				<vendor>openjdk</vendor>
			</provides>
			<configuration>
				<jdkHome>/usr/lib/jvm/java-11-openjdk-amd64/</jdkHome>
			</configuration>
		</toolchain>
	</toolchains>


Building
--------

Compiling is a simple Maven command:

	mvn clean install

