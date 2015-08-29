package com.moesol.url;

import java.io.BufferedInputStream;
import java.net.URL;

import com.moesol.cac.agent.selector.AbstractSelectorKeyManager;

public class DumpURL {

	/**
	 * @param args
	 */
	public static void main(String[] args) {
		try {
			CacHookingAgent.maybeSetTrustFile();
			AbstractSelectorKeyManager.configureSwingKeyManagerAsDefault();

			URL url = new URL(args[0]);
			BufferedInputStream bis = new BufferedInputStream(url.openStream());
			try {
				System.out.println("---ready---");
				System.in.read();
				byte[] buf = new byte[4096];
				while (true) {
					int r = bis.read(buf);
					if (r <= 0) {
						return;
					}
					System.out.write(buf, 0, r);
				}
			} finally {
				bis.close();
			}
		} catch (Exception e) {
			e.printStackTrace();
		}
	}
	
}
