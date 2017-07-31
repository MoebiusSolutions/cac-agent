package com.moesol.jgit;

import org.eclipse.jgit.pgm.Main;
import org.eclipse.jgit.transport.HttpTransport;
import org.eclipse.jgit.transport.http.JDKHttpConnectionFactory;

import com.moesol.url.CacHookingAgent;

public class JgitCac extends Main {
	
	public JgitCac() {
		super();
//		HttpTransport.setConnectionFactory(new HookedHttpClientConnectionFactory());
		HttpTransport.setConnectionFactory(new JDKHttpConnectionFactory());
	}

	public static void main(String[] argv) throws Exception {
		CacHookingAgent.premain(null, null);
		new JgitCac().run(argv);
	}
}
