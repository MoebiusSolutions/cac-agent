package com.moesol.cac.agent.selector;

import java.io.File;
import java.io.IOException;
import java.security.KeyStore;
import java.security.KeyStore.CallbackHandlerProtection;
import java.security.KeyStoreException;
import java.security.NoSuchAlgorithmException;
import java.security.Provider;
import java.security.Security;
import java.security.cert.CertificateException;
import java.util.ArrayList;
import java.util.List;
import java.util.logging.Level;
import java.util.logging.Logger;

import javax.security.auth.callback.Callback;
import javax.security.auth.callback.CallbackHandler;
import javax.security.auth.callback.PasswordCallback;
import javax.security.auth.callback.TextOutputCallback;
import javax.security.auth.callback.UnsupportedCallbackException;
import javax.swing.JOptionPane;

import com.moesol.cac.agent.Config;

public class Pkcs11SelectorKeyManager extends AbstractSelectorKeyManager {
	private static Logger LOGGER = Logger.getLogger(Pkcs11SelectorKeyManager.class.getName());
	private List<Provider> providers = new ArrayList<>();

	@Override
	protected KeyStore accessKeyStore() throws Exception {
		setUpProvider();
		
		chooser.showBusy("Accessing CAC...");
		try {
			Exception lastException = null;
			for (Provider provider : providers) {
				Object result = loadOrException(provider);
				if (result instanceof KeyStore) {
					return (KeyStore) result;
				}
				lastException = (Exception) result;
			}
			throw lastException;
		} finally {
			chooser.hideBusy();
		}
	}
	private Object loadOrException(Provider provider) {
		KeyStore ks;
		try {
			ks = KeyStore.Builder
					.newInstance("PKCS11", provider, makeCallbackHandler())
					.getKeyStore();
			ks.load(null, null);
			return ks;
		} catch (KeyStoreException | NoSuchAlgorithmException | CertificateException | IOException e) {
			return e;
		}
	}
	
	private CallbackHandlerProtection makeCallbackHandler() {
		CallbackHandler handler = new CallbackHandler() {
			@Override
			public void handle(Callback[] callbacks) throws IOException,
					UnsupportedCallbackException {
				for (Callback c : callbacks) {
					if (c instanceof PasswordCallback) {
						PasswordCallback pc = (PasswordCallback) c;
						pc.setPassword(chooser.promptForPin(pc.getPrompt()));
					} else if (c instanceof TextOutputCallback) {
						TextOutputCallback tc = (TextOutputCallback) c;
						switch (tc.getMessageType()) {
						case TextOutputCallback.INFORMATION:
							LOGGER.log(Level.INFO, "{0}", tc.getMessage());
							break;
						case TextOutputCallback.WARNING:
							LOGGER.log(Level.WARNING, "{0}", tc.getMessage());
							break;
						case TextOutputCallback.ERROR:
							LOGGER.log(Level.SEVERE, "{0}", tc.getMessage());
							break;
						default:
							throw new UnsupportedOperationException("TextOutputCallback: " + tc.getMessageType());
						}
					} else {
						LOGGER.log(Level.INFO, "Ignoring: {0}", c);
					}
				}
			}
		};
		return new KeyStore.CallbackHandlerProtection(handler);		
	}
	
	private void setUpProvider() {
		chooser.showBusy("Initializing PKCS#11...");
		try {
			File configFile = new File(Config.computeProfileFolder(), "pkcs11.cfg");
			String configName = configFile.getAbsolutePath();
			if (configFile.exists()) {
				addPkcs1ProviderFromFile(configName);
			} else {
				String message = "Not found: " + configName;
				String title = "PKCS#11 Configuration Not Loaded";
				JOptionPane.showMessageDialog(null, message, title, JOptionPane.WARNING_MESSAGE);
			}
			addExtraProviders();
		} finally {
			chooser.hideBusy();
		}
	}
	private void addExtraProviders() {
		/*
		 * Optionally, look for more pcks11.{n}.cfg files. This allows you to install
		 * multiple providers and slots. See:
		 * https://docs.oracle.com/javase/9/security/pkcs11-reference-guide1.htm
		 *
		 * <quote>To use more than one slot per PKCS#11 implementation, or to use more
		 * than one PKCS#11 implementation, simply repeat the installation for each with
		 * the appropriate configuration file. This will result in a SunPKCS11 provider
		 * instance for each slot of each PKCS#11 implementation.</quote>
		 */
		for (int n = 1; n < Integer.MAX_VALUE; n++) {
			File extraConfigFile = new File(Config.computeProfileFolder(), String.format("pkcs11.%d.cfg", n));
			if (!extraConfigFile.exists()) {
				break;
			}
			addPkcs1ProviderFromFile(extraConfigFile.getAbsolutePath());
		}
	}
	private void addPkcs1ProviderFromFile(String configName) {
		Provider provider = Security.getProvider("SunPKCS11");
		provider = provider.configure(configName);
		Security.addProvider(provider);
		providers.add(provider);
		LOGGER.log(Level.INFO, "Provider: {0}", provider.getInfo());
	}

	public static void main(String[] args) {
//		CacHookingAgent.DEBUG = true;
		Pkcs11SelectorKeyManager selector = new Pkcs11SelectorKeyManager();
		
		if (Boolean.getBoolean("tty")) {
			selector.setIdentityKeyChooser(new TtyIdentityKeyChooser(selector));
		}
		
		System.out.println("chose: "
				+ selector.chooseClientAlias(null, null, null));
		// Must not need to call System.exit(0) to shutdown or interferes with jgit.
	}

}
