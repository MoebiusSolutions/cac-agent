Compile cac-agent
================

Compile the cac-agent executable jar (requires that you have Maven and Java installed):

	git clone https://github.com/MoebiusSolutions/cac-agent.git
	cd cac-agent
	mvn install

Now you have:

* An library that contains cac support:
	* Windows: ```target\cac-agent-.jar```
	* Linux: ```target/cac-agent-.jar```

* An executable jar that contains jgit plus cac support:
	* Windows: ```target\cac-agent-...-with-dependencies.jar```
	* Linux: ```target/cac-agent-...-with-dependencies.jar```
