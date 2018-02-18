package com.moesol.jgit;

import org.eclipse.jgit.pgm.Main;
import org.eclipse.jgit.transport.HttpTransport;
import org.eclipse.jgit.transport.http.JDKHttpConnectionFactory;

import com.moesol.cac.agent.CacHookingAgent;

public class JgitCac extends Main {

	/**
	 * HookedHttpClientConnectionFactory is the new default. JDK mode is depreciated.
	 */
	private static boolean useJdkConnectionFactory = Boolean.getBoolean("use.jdk.connection.factory");
	
	public JgitCac() {
		super();
		
		if (!useJdkConnectionFactory) {
			HttpTransport.setConnectionFactory(new HookedHttpClientConnectionFactory());
		} else {
			HttpTransport.setConnectionFactory(new JDKHttpConnectionFactory());
		}
	}

	public static void main(String[] argv) throws Exception {
		if (useJdkConnectionFactory) {
			CacHookingAgent.premain(null, null);
		}
		
		new JgitCac().run(argv);
	}
}
