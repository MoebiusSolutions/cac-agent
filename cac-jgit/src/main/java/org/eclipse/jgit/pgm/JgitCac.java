package org.eclipse.jgit.pgm;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.util.ArrayList;
import java.util.List;

import org.eclipse.jgit.awtui.AwtAuthenticator;
import org.eclipse.jgit.awtui.AwtCredentialsProvider;
import org.eclipse.jgit.console.ConsoleAuthenticator;
import org.eclipse.jgit.console.ConsoleCredentialsProvider;
import org.eclipse.jgit.transport.ChainingCredentialsProvider;
import org.eclipse.jgit.transport.CredentialsProvider;
import org.eclipse.jgit.transport.HttpTransport;
import org.eclipse.jgit.transport.UsernamePasswordCredentialsProvider;
import org.eclipse.jgit.transport.http.JDKHttpConnectionFactory;

import com.moesol.cac.agent.CacHookingAgent;
import com.moesol.cac.agent.Config;
import com.moesol.jgit.HookedHttpClientConnectionFactory;

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
	void init(final TextBuiltin cmd) throws IOException {
		installCredentialProviderChains();
		super.init(cmd);
	}

	/**
	 * Duplicates a bit of functionality from Main class, since that functionality
	 * is not extensible. We don't add the NetRCCredentialProvider to the chain
	 * because it uses plaintext passwords.
	 */
	private void installCredentialProviderChains() {
		List<CredentialsProvider> providers = new ArrayList<>();
		if (hasConfiguredCredentials()) {
			providers.add(new UsernamePasswordCredentialsProvider(config.getUser(), config.getDecryptedPass()));
		}
		if (config.isTty()) {
			try {
				installConsole(providers);
			} catch (Exception e) {
				System.out.println("no console");
				installSwing(providers);
			}
		}
		if (hasConfiguredCredentials()) {
			CredentialsProvider.setDefault(
					new ChainingCredentialsProvider(providers.toArray(new CredentialsProvider[0])));
		}
	}

	private boolean hasConfiguredCredentials() {
		return config.getUser() != null && config.getDecryptedPass() != null;
	}

	protected void installConsole(List<CredentialsProvider> providers) {
		ConsoleAuthenticator.install();
		providers.add(new ConsoleCredentialsProvider());
	}
	protected void installSwing(List<CredentialsProvider> providers) {
		AwtAuthenticator.install();
		providers.add(new AwtCredentialsProvider());
	}

	private static void encryptPassword() throws IOException {
		try (BufferedReader br = new BufferedReader(new InputStreamReader(System.in))) {
			System.out.println("");
			System.out.println("Enter git password:");
			String gitPass = br.readLine();
			System.out.println("");
			System.out.println("Enter a 'master' password (protects git password):");
			String masterPass = br.readLine();
			System.out.println("");
			System.out.println("== Encrypted Git Password ==");
			System.out.println(Config.encryptPass(masterPass, gitPass));
			System.out.println("");
		}
	}

	public static void main(String[] argv) throws Exception {
		if (argv.length == 1 && "--cac-agent-encrypt".equals(argv[0])) {
			encryptPassword();
			return;
		}

		if (useJdkConnectionFactory) {
			CacHookingAgent.premain(null, null);
		}

		new JgitCac().run(argv);
	}
}
