Compile cac-agent
================

Compile the cac-agent executable jar (requires that you have Maven and Java installed):

	git clone https://github.com/MoebiusSolutions/cac-agent.git
	cd cac-agent
	mvn install

Now you have (under the ```target``` directory):

* A library that contains cac support:

		cac-agent-.jar```

* An executable jar that contains jgit plus cac support:

		cac-agent-...-with-dependencies.jar```
