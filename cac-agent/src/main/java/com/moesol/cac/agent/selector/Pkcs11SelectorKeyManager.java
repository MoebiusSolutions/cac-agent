package com.moesol.cac.agent.selector;

import java.io.File;
import java.io.IOException;
import java.security.KeyStore;
import java.security.KeyStore.Builder;
import java.security.KeyStoreException;
import java.security.Provider;
import java.security.ProviderException;
import java.security.Security;
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
import com.moesol.cac.agent.Pkcs11Provider;

public class Pkcs11SelectorKeyManager extends AbstractSelectorKeyManager {
	private static Logger LOGGER = Logger.getLogger(Pkcs11SelectorKeyManager.class.getName());

	private final Object buildersLock = new Object();
	private List<KeyStoreBuilderWrapper> builders = new ArrayList<>();
	private String providerDescription = "unavailable";

	private static class KeyStoreBuilderWrapper {
		public final KeyStore.Builder builder;
		public final String description;
		
		public KeyStoreBuilderWrapper(KeyStore.Builder builder, String description) {
			this.builder = builder;
			this.description = description;
		}
	}

	/**
	 * Overrides getKeyStore because AbstractSelectorKeyManager caches the keyStore
	 * too aggressively for smartcards that can be removed/inserted.
	 */
	@Override
	public KeyStore getKeyStore() {
		ensureBuilders();
		
		synchronized (keyStoreLock) {
			while (true) {
				try {
					providerDescription = "unavailable";
					setKeyStore(null); // In case of exception.
					KeyStore ks = accessKeyStore();
					setKeyStore(ks);
					return ks;
				} catch (Exception e) {
					// Cannot get out of this method without a valid KeyStore.
					String msg = e.getLocalizedMessage();
					if (msg == null || msg.equals("null")) {
						msg = "";
					}
					chooser.promptForCardInsertion(providerDescription, msg);
				}
			}
		}
	}
	
	@Override
	protected KeyStore accessKeyStore() throws KeyStoreException {
		chooser.showBusy("Accessing Smart Card...");
		try {
			// Try to get a keystore from any of the builders
			// The first success wins, if all fail, report last failure.
			KeyStoreException lastException = null;
			for (KeyStoreBuilderWrapper wrapper : builders) {
				try {
					providerDescription = wrapper.description;
					return wrapper.builder.getKeyStore();
				} catch (KeyStoreException e) {
					lastException = e;
				}
			}
			throw lastException;
		} finally {
			chooser.hideBusy();
		}
	}
	
	/**
	 * Make builders only once per Pkcs11SelectorKeyManager.
	 */
	private void ensureBuilders() {
		synchronized (buildersLock) {
			if (!builders.isEmpty()) {
				return;
			}
			setUpBuilders();
		}
	}

	private void setUpBuilders() {
		List<Provider> providers = setUpProvider();
		for (Provider provider : providers) {
			// https://docs.oracle.com/javase/9/security/pkcs11-reference-guide1.htm#JSSEC-GUID-4C366313-33B9-458C-A845-33D0C8A9C367
			KeyStore.CallbackHandlerProtection chp =
				    new KeyStore.CallbackHandlerProtection(new Pkcs11CallbackHandler(provider));
			Builder builder = KeyStore.Builder
					.newInstance("PKCS11", provider, chp);
			
			builders.add(new KeyStoreBuilderWrapper(builder, provider.getName()));
		}
	}
	
	private class Pkcs11CallbackHandler implements CallbackHandler {
		private final Provider provider;
		
		public Pkcs11CallbackHandler(Provider provider) {
			this.provider = provider;
		}
		@Override
		public void handle(Callback[] callbacks) throws IOException,
				UnsupportedCallbackException {
			for (Callback c : callbacks) {
				if (c instanceof PasswordCallback) {
					PasswordCallback pc = (PasswordCallback) c;
					pc.setPassword(chooser.promptForPin(provider.getName(), "PIN to Unlock Token:"));
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
	}

	private List<Provider> setUpProvider() {
		chooser.showBusy("Initializing PKCS#11...");

		final List<Provider> providers = new ArrayList<>();

		try {
			File configFile = new File(Config.computeProfileFolder(), "pkcs11.cfg");
			String configName = configFile.getAbsolutePath();
			if (configFile.exists()) {
				addPkcs11ProviderFromFile(configName, providers);
			} else {
				String message = "Not found: " + configName;
				String title = "PKCS#11 Configuration Not Loaded";
				JOptionPane.showMessageDialog(null, message, title, JOptionPane.WARNING_MESSAGE);
			}
			addExtraProviders(providers);
			return providers;
		} finally {
			chooser.hideBusy();
		}
	}
	private void addExtraProviders(List<Provider> providers) {
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
			try {
				addPkcs11ProviderFromFile(extraConfigFile.getAbsolutePath(), providers);
			} catch (ProviderException e) {
				LOGGER.log(Level.WARNING, "Provider failed to init {0}", extraConfigFile);
			}
		}
	}

	private void addPkcs11ProviderFromFile(String configName, List<Provider> providers) {
		Provider provider = Pkcs11Provider.get(configName);
		Security.addProvider(provider);
		providers.add(provider);
		LOGGER.log(Level.INFO, "Provider: {0}", provider.getInfo());
	}

	public static void main(String[] args) throws InterruptedException {
		Pkcs11SelectorKeyManager selector = new Pkcs11SelectorKeyManager();
		for (int i = 0 ; i < 6; i++) {
			doOneChoice(selector);
			Thread.sleep(10000);
		}
		// Must not need to call System.exit(0) to shutdown or interferes with jgit
	}
	private static void doOneChoice(Pkcs11SelectorKeyManager selector) {
//		CacHookingAgent.DEBUG = true;
		if (Boolean.getBoolean("tty")) {
			selector.setIdentityKeyChooser(new TtyIdentityKeyChooser(selector));
		}
		
		System.out.println("chose: "
				+ selector.chooseClientAlias(null, null, null));
	}

}
