package com.moesol.cac.key.selector;

import java.net.Socket;
import java.security.KeyManagementException;
import java.security.KeyStore;
import java.security.KeyStoreException;
import java.security.NoSuchAlgorithmException;
import java.security.Principal;
import java.security.PrivateKey;
import java.security.cert.Certificate;
import java.security.cert.CertificateParsingException;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Enumeration;
import java.util.List;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.KeyManager;
import javax.net.ssl.SSLContext;
import javax.net.ssl.X509KeyManager;
import javax.swing.JOptionPane;
import javax.swing.SwingUtilities;

import com.moesol.url.Config;
import com.moesol.url.CacHookingAgent;

/**
 * When installed as the default key manager, this class prompts the user as needed to choose a key.
 * @author hastings
 */
public abstract class SwingSelectorKeyManager implements X509KeyManager {
	private String choosenAlias = null;
	private final Object keyStoreLock = new Object();
	private KeyStore keyStore;
	
	public SwingSelectorKeyManager() {
	}

	/**
	 * Injects this manager into the SSLContext.
	 * @throws NoSuchAlgorithmException
	 * @throws KeyManagementException
	 */
	public static void configureSwingKeyManagerAsDefault() throws NoSuchAlgorithmException, KeyManagementException {
		if (CacHookingAgent.DEBUG) { System.out.println("Context: " + CacHookingAgent.CONTEXT); }
		KeyManager[] kmgrs = makeKeyManagers();
		SSLContext sslContext = SSLContext.getInstance(CacHookingAgent.CONTEXT);
		sslContext.init(kmgrs, null, new java.security.SecureRandom());
		SSLContext.setDefault(sslContext);

		HttpsURLConnection.setDefaultSSLSocketFactory(sslContext.getSocketFactory());
	}
	private static KeyManager[] makeKeyManagers() {
		String os = System.getProperty("os.name").toLowerCase();
		if (os.startsWith("win")) {
			System.out.println("Windows key manager");
			return new KeyManager[] { new WindowsSelectorKeyManager() };
		} else {
			System.out.println("Linux key manager");
			return new KeyManager[] { new Pkcs11SelectorKeyManager() };
		}
	}
	
	private KeyStore getKeyStore() {
		synchronized (keyStoreLock) {
			if (keyStore != null) {
				return keyStore;
			}
			try {
				keyStore = accessKeyStore();
			} catch (Exception e) {
				reportAndConvert(e);
			}
			return keyStore;
		}
	}
	
	protected abstract KeyStore accessKeyStore() throws Exception;

	@Override
	public synchronized String chooseClientAlias(final String[] keyType, final Principal[] issuers, Socket socket) {
		if (CacHookingAgent.DEBUG) { System.out.println("chooseClientAlias: "); }
		if (choosenAlias != null) {
			if (CacHookingAgent.DEBUG) { System.out.println("cached chooseClientAlias: " + choosenAlias); }
			return choosenAlias;
		}
		
		Config config = Config.loadFromUserHome();
		choosenAlias = config.getDefaultCertificateName();
		if (choosenAlias != null) {
			choosenAlias = choosenAlias.trim();
			if (!choosenAlias.isEmpty()) {
				if (CacHookingAgent.DEBUG) { System.out.println("config chooseClientAlias: " + choosenAlias); }
				return choosenAlias;
			}
		}
		
		try {
			final String[] aliases = getClientAliases(null, issuers);
			SwingUtilities.invokeAndWait(new Runnable() {
				@Override
				public void run() {
					choosenAlias = pickOnSwingThread(aliases);
				}
			});
		} catch (Exception e) {
			throw reportAndConvert(e);
		}
		if (CacHookingAgent.DEBUG) { System.out.println("chooseClientAlias: " + choosenAlias); }
		return choosenAlias;
	}

	private String pickOnSwingThread(String[] aliases) {
		Object[] possibilities = makeCertList(aliases);
		Object pick = JOptionPane.showInputDialog(null,
		                    "Choose certificate:",
		                    "Customized Dialog",
		                    JOptionPane.PLAIN_MESSAGE,
		                    null,
		                    possibilities,
		                    possibilities[0]);
		if (pick != null) {
			CertDescription cert = (CertDescription) pick;
			return cert.getAlias();
		}
		return null;
	}
	
	private Object[] makeCertList(String[] aliases) {
		if (keyStore == null) {
			return new Object[] { 
				new CertDescription(null, "<No Identifies Found>"),
			};
		}
		
		Object[] result = new Object[aliases.length];
		for (int i = 0; i < aliases.length; i++) {
			final String alias = aliases[i]; 
			Certificate cert;
			try {
				cert = keyStore.getCertificate(alias);
				X509Certificate x509 = (X509Certificate) cert; 
				String purpose = X509PurposeDecoder.decode(x509);
				Collection<List<?>> alt = x509.getSubjectAlternativeNames();
				String names = alt == null ? x509.getSubjectX500Principal().toString() : alt.toString();
				
				String desc = String.format("%s, %s, %s", alias, purpose, names);
				
				result[i] = new CertDescription(alias, desc);
			} catch (ClassCastException | KeyStoreException | CertificateParsingException e1) {
				result[i] = new CertDescription(alias, alias);
			}
		}
		return result;
	}

	@Override
	public X509Certificate[] getCertificateChain(String alias) {
		try {
			return (X509Certificate[]) getKeyStore().getCertificateChain(alias);
		} catch (KeyStoreException e) {
			throw reportAndConvert(e);
		}
	}

	@Override
	public String[] getClientAliases(String keyType, Principal[] issuers) {
		if (CacHookingAgent.DEBUG) { System.out.println("getClientAliases: "); }
		try {
			KeyStore ks = getKeyStore();
			if (ks == null) {
				return new String[0];
			}
			ArrayList<String> asList = new ArrayList<String>();
			Enumeration<String> aliases = ks.aliases();
			while (aliases.hasMoreElements()) {
				// TODO filter by keyType/issuers?
				asList.add(aliases.nextElement());
			}
			return asList.toArray(new String[asList.size()]);
		} catch (KeyStoreException e) {
			throw reportAndConvert(e);
		}
	}

	@Override
	public PrivateKey getPrivateKey(String alias) {
		try {
			return (PrivateKey) getKeyStore().getKey(alias, null);
		} catch (Exception e) {
			throw reportAndConvert(e);
		}
	}

	@Override
	public String chooseServerAlias(String keyType, Principal[] issuers, Socket socket) {
		throw new UnsupportedOperationException("Client manager only");
	}
	
	@Override
	public String[] getServerAliases(String keyType, Principal[] issuers) {
		throw new UnsupportedOperationException("Client manager only");
	}
	
	protected RuntimeException reportAndConvert(final Exception e) {
		SwingUtilities.invokeLater(new Runnable() {
			@Override
			public void run() {
				JOptionPane.showMessageDialog(null, e.getLocalizedMessage(), "Failed", JOptionPane.ERROR_MESSAGE);
			}
		});
		return new RuntimeException(e);
	}
	
}