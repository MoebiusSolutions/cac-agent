package com.moesol.jgit;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

import org.eclipse.jgit.awtui.AwtAuthenticator;
import org.eclipse.jgit.awtui.AwtCredentialsProvider;
import org.eclipse.jgit.console.ConsoleAuthenticator;
import org.eclipse.jgit.console.ConsoleCredentialsProvider;
import org.eclipse.jgit.lib.Repository;
import org.eclipse.jgit.pgm.Main;
import org.eclipse.jgit.transport.ChainingCredentialsProvider;
import org.eclipse.jgit.transport.CredentialsProvider;
import org.eclipse.jgit.transport.HttpTransport;
import org.eclipse.jgit.transport.UsernamePasswordCredentialsProvider;
import org.eclipse.jgit.transport.http.JDKHttpConnectionFactory;
import org.eclipse.jgit.util.CachedAuthenticator;
import org.eclipse.jgit.util.CachedAuthenticator.CachedAuthentication;

import com.moesol.cac.agent.CacHookingAgent;
import com.moesol.cac.agent.Config;

public class JgitCac extends Main {

	private final Config config = Config.loadFromUserHome();

	/**
	 * HookedHttpClientConnectionFactory is the new default. JDK mode is depreciated.
	 */
	private static boolean useJdkConnectionFactory = Boolean.getBoolean("use.jdk.connection.factory");

	public JgitCac() {
		super();

		if (!useJdkConnectionFactory) {
			HttpTransport.setConnectionFactory(new HookedHttpClientConnectionFactory(config));
		} else {
			HttpTransport.setConnectionFactory(new JDKHttpConnectionFactory());
		}
	}

	@Override
	protected Repository openGitDir(String aGitdir) throws IOException {
		installCredentialProviderChains();
		return super.openGitDir(aGitdir);
	}

	/**
	 * Duplicates a bit of functionality from Main class, since that functionality
	 * is not extensible. We don't add the NetRCCredentialProvider to the chain
	 * because it uses plaintext passwords.
	 */
	private void installCredentialProviderChains() {
		List<CredentialsProvider> providers = new ArrayList<>();
		if (hasEncryptedPassword()) {
			providers.add(new UsernamePasswordCredentialsProvider(config.getUser(), config.decryptPass()));
		}
		if (config.isTty()) {
			try {
				installConsole(providers);
			} catch (Exception e) {
				System.out.println("no console");
				installSwing(providers);
			}
		}

		CredentialsProvider.setDefault(
			new ChainingCredentialsProvider(providers.toArray(new CredentialsProvider[0]))
		);
	}

	private boolean hasEncryptedPassword() {
		return config.getUser() != null &&
				config.getPass() != null &&
				config.getMaster() != null
				;
	}

	protected void installConsole(List<CredentialsProvider> providers) {
		ConsoleAuthenticator.install();
		providers.add(new ConsoleCredentialsProvider());
	}
	protected void installSwing(List<CredentialsProvider> providers) {
		AwtAuthenticator.install();
		providers.add(new AwtCredentialsProvider());
	}

	public static void main(String[] argv) throws Exception {
		if (useJdkConnectionFactory) {
			CacHookingAgent.premain(null, null);
		}

		CachedAuthentication cached = new CachedAuthentication("rite.sd.spawar.navy.mil", 443, "rhastings", "5tgb%TGB5tgb%TGB");
		CachedAuthenticator.add(cached);

		new JgitCac().run(argv);
	}
}
