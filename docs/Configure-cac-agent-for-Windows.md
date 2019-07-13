Configure cac-agent for Windows
================

On Windows this agent sets up the Windows-MY keystore so that Java can
integration with Windows. If you have your CAC working with IE or Chrome then
Java will be able to share this configuration.

In the `agent.properties` file, you can turn this feature off with.

	use.windows.trust: false

However, it is `true` by default.
